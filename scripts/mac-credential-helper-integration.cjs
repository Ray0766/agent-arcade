'use strict';
// Real native integration, using a newly created, explicit test Keychain only.
// Never opens the App, login Keychain, owner vault or a model endpoint.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const {prepareMacBuild, unlockLocalSigning} = require('./build-mac.cjs');

if (process.platform !== 'darwin') {
  console.log('SKIP: native credential helper integration requires macOS.');
  process.exit(0);
}
const repository = path.resolve(__dirname, '..');
const root = fs.mkdtempSync('/private/tmp/arcade-vault-native-integration-');
fs.chmodSync(root, 0o700);
const previousUmask = process.umask(0o077);
const testID = crypto.randomUUID();
const service = `agent-arcade.test.${testID}`;
const account = service;
const testchain = path.join(root, 'test.keychain-db');
const helper = path.join(root, 'fixed-helper');
const setup = path.join(root, 'test-keychain-setup');
const fixtureID = `io.github.agentarcade.test.peer.${testID}`;
const cipherFile = path.join(root, 'synthetic-v10.bin');
const keychainPassword = crypto.randomBytes(32).toString('base64');
const receipt = {schema: 1, test: 'fixed-native-helper', privateRoot: root,
  syntheticOnly: true, productionVaultOpened: false, productionKeychainQueried: false,
  parents: [], checks: [], passed: false};
let initialSearchList, initialDefault;

function tool(command, args, {input, timeout = 30_000, expected = 0, label = 'native-tool'} = {}) {
  const result = spawnSync(command, args, {cwd: repository, input, encoding: 'utf8',
    timeout, maxBuffer: 2 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe']});
  if (result.error || result.status !== expected) {
    // Build diagnostics contain no private signing password. Do not attach a
    // spawn error/argv: the private fake Keychain password can appear in argv.
    const safeStageOutput = /^(?:verify-.*fake-item|create-private-testchain)$/.test(label) ? String(result.stdout || '') : '';
    fs.writeFileSync(path.join(root, `${label}.diagnostic.log`), String(result.stderr || '') + safeStageOutput, {mode: 0o600});
    throw Error(`${label} failed (exit ${result.status ?? 'none'}, signal ${result.signal ?? 'none'}); private diagnostic retained.`);
  }
  return result;
}
function metadata(command) {
  return tool('/usr/bin/security', [command, '-d', 'user'], {label: command}).stdout.trim();
}
function searchList() {
  const raw = metadata('list-keychains');
  return raw ? raw.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line.trim())) : [];
}
function defaultKeychain() { return metadata('default-keychain'); }
function restoreOnlyTestchain() {
  if (!initialSearchList) return;
  const current = searchList();
  const withoutTest = current.filter(entry => path.resolve(entry) !== testchain);
  if (withoutTest.length !== current.length) tool('/usr/bin/security',
    ['list-keychains', '-d', 'user', '-s', ...withoutTest], {label: 'remove-only-test-search-entry'});
  const currentDefault = defaultKeychain();
  if (currentDefault && JSON.parse(currentDefault) === testchain) {
    tool('/usr/bin/security', ['default-keychain', '-d', 'user', '-s', JSON.parse(initialDefault)], {label: 'restore-test-default'});
  }
  assert.deepEqual(searchList(), initialSearchList, 'User search list changed beyond this test; no unrelated entries were overwritten.');
  assert.equal(defaultKeychain(), initialDefault, 'User default Keychain changed beyond this test.');
}
function write(name, bytes) {
  const file = path.join(root, name);
  fs.writeFileSync(file, bytes, {mode: 0o600});
  return file;
}
function compile(source, output, extra = []) {
  tool('/usr/bin/xcrun', ['swiftc', '-parse-as-library', '-O', '-module-cache-path', path.join(root, 'module-cache'),
    source, ...extra, '-o', output], {label: `compile-${path.basename(output)}`, timeout: 60_000});
  fs.chmodSync(output, 0o700);
}
function cdhash(file) {
  const result = tool('/usr/bin/codesign', ['-d', '--verbose=4', file], {label: 'signature-metadata'});
  const match = /^CDHash=([0-9a-f]{40})$/mi.exec(result.stderr);
  assert.ok(match, 'Missing native CDHash.');
  return match[1].toLowerCase();
}
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function sign(file, identifier, plan, adhoc = false) {
  tool('/usr/bin/codesign', ['--force', '--sign', adhoc ? '-' : plan.identity.sha1,
    ...(adhoc ? [] : ['--keychain', plan.profile.keychainFile]), '--identifier', identifier,
    '--options', 'runtime,kill', '--timestamp=none', file], {label: `sign-${path.basename(file)}`});
  tool('/usr/bin/codesign', ['--verify', '--strict', '--verbose=2', file], {label: 'verify-native-signature'});
}
function fixture(file, scenario, expected = true) {
  const result = tool(file, [scenario], {label: `fixture-${scenario}`, timeout: 15_000});
  const value = JSON.parse(result.stdout);
  receipt.checks.push({scenario, ...value});
  assert.equal(value.ok, expected, `${scenario} native boolean receipt failed.`);
  assert.equal(result.stderr, '', `${scenario} emitted unexpected native stderr.`);
  return value;
}

async function main() {
  initialSearchList = searchList();
  initialDefault = defaultKeychain();
  const plan = prepareMacBuild(['--require-stable-signing'], process.env, undefined,
    {beforeIdentityInspection: profile => unlockLocalSigning(profile)});
  assert.ok(plan.profile && plan.identity, 'A validated dedicated local signing profile is required.');
  const peerRequirement = `identifier "${fixtureID}" and certificate root = H"${plan.identity.sha1.toLowerCase()}"`;
  const config = write('BrokerConfiguration.swift', `enum BrokerConfiguration {
    static let peerRequirement = ${JSON.stringify(peerRequirement)}
    static let service = ${JSON.stringify(service)}
    static let account = ${JSON.stringify(account)}
    static let keychainPath = ${JSON.stringify(testchain)}
    static let testing = true
}
`);
  compile(path.join(repository, 'src/mac/credential-helper.swift'), helper, [config]);
  sign(helper, `io.github.agentarcade.test.helper.${testID}`, plan);
  const stableHash = sha256(helper), stableCDHash = cdhash(helper);
  receipt.helper = {sha256: stableHash, cdhash: stableCDHash};

  const setupSource = write('keychain-setup.swift', String.raw`
import Foundation
import Security
import Darwin
@main enum SetupMain {
 static func main() {
  do {
   guard SecKeychainSetUserInteractionAllowed(false) == errSecSuccess else { throw NSError(domain:"setup",code:1) }
   let mode = CommandLine.arguments.dropFirst().first ?? ""
   let path = ${JSON.stringify(testchain)}
   let service = ${JSON.stringify(service)}
   let account = ${JSON.stringify(account)}
   let fake = Data("mock_password".utf8)
   var chain: SecKeychain?
   if mode == "create" {
    let input = FileHandle.standardInput.readDataToEndOfFile()
    guard input.count < 4096, let object = try JSONSerialization.jsonObject(with:input) as? [String:String],
          let password = object["password"] else { throw NSError(domain:"setup",code:2) }
    let passwordBytes = Data(password.utf8)
    let status = passwordBytes.withUnsafeBytes { SecKeychainCreate(path, UInt32(passwordBytes.count), $0.baseAddress, false, nil, &chain) }
    guard status == errSecSuccess, let chain else { throw NSError(domain:"setup",code:3) }
    var apps: [SecTrustedApplication] = []
    for allowed in [${JSON.stringify(helper)}, ${JSON.stringify(setup)}] {
     var app: SecTrustedApplication?
     guard SecTrustedApplicationCreateFromPath(allowed, &app) == errSecSuccess, let app else { throw NSError(domain:"setup",code:4) }
     apps.append(app)
    }
    var access: SecAccess?
    guard SecAccessCreate("Agent Arcade synthetic integration item" as CFString, apps as CFArray, &access) == errSecSuccess,
          let access else { throw NSError(domain:"setup",code:5) }
    let add: [String:Any] = [kSecClass as String:kSecClassGenericPassword, kSecAttrService as String:service,
      kSecAttrAccount as String:account, kSecValueData as String:fake, kSecUseKeychain as String:chain,
      kSecAttrAccess as String:access]
    guard SecItemAdd(add as CFDictionary,nil) == errSecSuccess else { throw NSError(domain:"setup",code:6) }
   } else if mode == "verify" {
    guard SecKeychainOpen(path,&chain) == errSecSuccess, let chain else { throw NSError(domain:"setup",code:7) }
    var result: CFTypeRef?
    let query: [String:Any] = [kSecClass as String:kSecClassGenericPassword, kSecAttrService as String:service,
      kSecAttrAccount as String:account,kSecMatchSearchList as String:[chain],kSecMatchLimit as String:kSecMatchLimitAll,
      kSecReturnRef as String:true]
    let lookupStatus = SecItemCopyMatching(query as CFDictionary,&result)
    if lookupStatus != errSecSuccess { throw NSError(domain:"setup",code:800000 + Int(lookupStatus)) }
    guard let matches = result as? [SecKeychainItem] else { throw NSError(domain:"setup",code:81) }
    guard matches.count == 1 else { throw NSError(domain:"setup",code:82) }
    var single = query
    single.removeValue(forKey:kSecReturnRef as String)
    single[kSecMatchLimit as String] = kSecMatchLimitOne
    single[kSecMatchItemList as String] = [matches[0]]
    single[kSecReturnData as String] = true
    var secret: CFTypeRef?
    let readStatus = SecItemCopyMatching(single as CFDictionary,&secret)
    if readStatus != errSecSuccess { throw NSError(domain:"setup",code:900000 + Int(readStatus)) }
    guard let bytes = secret as? Data, bytes == fake else { throw NSError(domain:"setup",code:83) }
   } else { throw NSError(domain:"setup",code:9) }
   print("{\"ok\":true}")
  } catch let error as NSError {
   // Only our fixed stage number is exposed; never underlying Keychain errors.
   print("{\"ok\":false,\"stage\":\(error.domain == "setup" ? error.code : 0)}")
   exit(1)
  }
 }
}
`);
  compile(setupSource, setup);
  sign(setup, `io.github.agentarcade.test.setup.${testID}`, plan);
  const created = tool(setup, ['create'], {input: JSON.stringify({password: keychainPassword}), label: 'create-private-testchain'});
  assert.equal(JSON.parse(created.stdout).ok, true);
  restoreOnlyTestchain(); // SecKeychainCreate may insert this one chain in search.
  // The fake item's normal ACL trusts only these two exact signed applications.
  // Give only their exact CDHashes partition access, simulating one grant for
  // this dedicated synthetic item. No owner item/global partition is touched.
  tool('/usr/bin/security', ['set-generic-password-partition-list', '-a', account, '-s', service,
    '-S', `cdhash:${stableCDHash},cdhash:${cdhash(setup)}`, '-k', keychainPassword, testchain],
    {label: 'grant-only-test-item-exact-partitions'});
  assert.equal(JSON.parse(tool(setup, ['verify'], {label: 'verify-initial-fake-item'}).stdout).ok, true);

  const expectedText = 'Synthetic cross-build credential · 测试';
  const legacyText = 'Legacy synthetic credential · 旧格式';
  const legacyKey = crypto.pbkdf2Sync('mock_password', 'saltysalt', 1003, 16, 'sha1');
  const legacyCipher = crypto.createCipheriv('aes-128-cbc', legacyKey, Buffer.alloc(16, 0x20));
  const legacyBytes = Buffer.concat([Buffer.from('v10'), legacyCipher.update(legacyText, 'utf8'), legacyCipher.final()]);
  legacyKey.fill(0);
  function parentSource(revision) { return String.raw`
import Foundation
import Darwin
private func line(_ handle: FileHandle) throws -> [String:Any] {
 var data = Data()
 while data.count <= 524288 {
  let byte = handle.readData(ofLength:1)
  if byte.isEmpty { break }
  if byte[0] == 10 { break }
  data.append(byte)
 }
 guard let object = try JSONSerialization.jsonObject(with:data) as? [String:Any] else { throw NSError(domain:"fixture",code:1) }
 return object
}
@main enum FixtureMain {
 static func main() {
  signal(SIGPIPE,SIG_IGN)
  let revision = ${JSON.stringify(revision)}
  let scenario = CommandLine.arguments.dropFirst().first ?? ""
  var outcome: [String:Any] = ["revision":revision,"ok":false]
  do {
   let child = Process(), input = Pipe(), output = Pipe(), errors = Pipe()
   child.executableURL = URL(fileURLWithPath:${JSON.stringify(helper)})
   child.standardInput = input; child.standardOutput = output; child.standardError = errors
   try child.run()
   let first = try line(output.fileHandleForReading)
   if scenario == "unauthorized" {
    input.fileHandleForWriting.closeFile()
    child.waitUntilExit()
    outcome["ok"] = first["status"] as? String == "error" && first["code"] as? String == "unauthorized" && child.terminationStatus != 0
    outcome["rejectedBeforeReady"] = first["status"] as? String != "ready"
   } else {
    guard first["status"] as? String == "ready", first["pid"] as? Int == Int(child.processIdentifier) else { throw NSError(domain:"fixture",code:2) }
    outcome["readyPIDMatches"] = true
    if scenario == "abandon" {
     outcome["helperPID"] = Int(child.processIdentifier)
     outcome["ok"] = true
     // A sibling holds the writer as its stdin for two seconds, so EOF alone
     // cannot explain helper exit. Process uses native posix_spawn on macOS.
     let keeper = Process()
     keeper.executableURL = URL(fileURLWithPath:"/bin/sleep")
     keeper.arguments = ["2"]
     keeper.standardInput = input.fileHandleForWriting
     keeper.standardOutput = FileHandle.nullDevice
     keeper.standardError = FileHandle.nullDevice
     try keeper.run()
     let encoded = try JSONSerialization.data(withJSONObject:outcome,options:[.sortedKeys])
     FileHandle.standardOutput.write(encoded); FileHandle.standardOutput.write(Data([10])); _exit(0)
    }
    let request: Data
    switch scenario {
    case "encrypt": request = try JSONSerialization.data(withJSONObject:["version":1,"operation":"encrypt","text":${JSON.stringify(expectedText)}])
    case "decrypt": request = try JSONSerialization.data(withJSONObject:["version":1,"operation":"decrypt","data":try Data(contentsOf:URL(fileURLWithPath:${JSON.stringify(cipherFile)})).base64EncodedString()])
    case "legacy": request = try JSONSerialization.data(withJSONObject:["version":1,"operation":"decrypt","data":${JSON.stringify(legacyBytes.toString('base64'))}])
    case "status": request = Data("{\"version\":1,\"operation\":\"status\"}".utf8)
    case "malformed": request = Data("{\"version\":1,\"operation\":\"status\",\"service\":\"other\"}".utf8)
    case "overbound": request = Data(repeating:0x20,count:524289)
    default: throw NSError(domain:"fixture",code:4)
    }
    // Deliberately use Darwin.write: an overbound request can close the reader
    // while we're writing; EPIPE is a bounded test result, not a Swift trap.
    request.withUnsafeBytes { bytes in
     var offset = 0
     while offset < bytes.count {
      let count = Darwin.write(input.fileHandleForWriting.fileDescriptor,bytes.baseAddress!.advanced(by:offset),bytes.count-offset)
      if count <= 0 { break }; offset += count
     }
    }
    input.fileHandleForWriting.closeFile()
    let response = try line(output.fileHandleForReading)
    child.waitUntilExit()
    if scenario == "malformed" || scenario == "overbound" {
     outcome["ok"] = response["status"] as? String == "error" && response["code"] as? String == "invalid_request" && child.terminationStatus != 0
    } else if scenario == "encrypt" {
     guard response["status"] as? String == "ok", let encoded = response["data"] as? String,
           let encrypted = Data(base64Encoded:encoded), encrypted.starts(with:Data("v10".utf8)) else { throw NSError(domain:"fixture",code:5) }
     try encrypted.write(to:URL(fileURLWithPath:${JSON.stringify(cipherFile)}),options:[.atomic])
     outcome["ok"] = child.terminationStatus == 0
    } else if scenario == "decrypt" || scenario == "legacy" {
     outcome["ok"] = response["status"] as? String == "ok" && response["text"] as? String == (scenario == "legacy" ? ${JSON.stringify(legacyText)} : ${JSON.stringify(expectedText)}) && child.terminationStatus == 0
    } else {
     outcome["ok"] = response["status"] as? String == "ok" && response["available"] as? Bool == true && child.terminationStatus == 0
    }
   }
   outcome["helperStderrEmpty"] = errors.fileHandleForReading.readDataToEndOfFile().isEmpty
  } catch let error as NSError {
   outcome["ok"] = false
   outcome["fixtureStage"] = error.domain == "fixture" ? error.code : 0
  }
  if let bytes = try? JSONSerialization.data(withJSONObject:outcome,options:[.sortedKeys]) {
   FileHandle.standardOutput.write(bytes); FileHandle.standardOutput.write(Data([10]))
  }
 }
}
`; }
  const parents = [];
  for (const revision of ['A', 'B', 'C']) {
    const file = path.join(root, `native-peer-${revision}`);
    compile(write(`parent-${revision}.swift`, parentSource(revision)), file);
    sign(file, fixtureID, plan);
    parents.push(file);
    receipt.parents.push({revision, cdhash: cdhash(file)});
  }
  assert.equal(new Set(receipt.parents.map(value => value.cdhash)).size, 3, 'A/B/C must have distinct native CDHashes.');
  fixture(parents[0], 'legacy');
  fixture(parents[0], 'encrypt');
  fixture(parents[1], 'decrypt');
  fixture(parents[2], 'decrypt');
  fixture(parents[2], 'status');
  fixture(parents[0], 'malformed');
  fixture(parents[1], 'overbound');
  const wrong = path.join(root, 'native-wrong-identifier');
  fs.copyFileSync(parents[0], wrong); sign(wrong, `${fixtureID}.wrong`, plan);
  fixture(wrong, 'unauthorized');
  const adhoc = path.join(root, 'native-wrong-signer');
  fs.copyFileSync(parents[0], adhoc); sign(adhoc, fixtureID, plan, true);
  fixture(adhoc, 'unauthorized');
  const abandoned = fixture(parents[0], 'abandon');
  let gone = false;
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    try { process.kill(abandoned.helperPID, 0); } catch (error) { if (error.code === 'ESRCH') { gone = true; break; } throw error; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(gone, true, 'Helper survived parent exit.');
  receipt.checks.push({scenario: 'parent-exit-cleanup', ok: true});
  assert.equal(JSON.parse(tool(setup, ['verify'], {label: 'verify-unchanged-fake-item'}).stdout).ok, true);
  assert.equal(sha256(helper), stableHash); assert.equal(cdhash(helper), stableCDHash);
  restoreOnlyTestchain();
  receipt.fixedHelperUnchanged = true;
  receipt.fakeItemUnchanged = true;
  receipt.searchListAndDefaultUnchanged = true;
  receipt.normalHelperUserInteractionDisabled = true;
  receipt.authorizationFixture = 'Only the dedicated fake item ACL/partition was narrowly set to helper/setup CDHashes to simulate an already authorized helper; this does not accept human first authorization.';
  receipt.boundary = 'Dedicated synthetic Keychain and native parents only; not owner-App, real credential or future macOS acceptance.';
  receipt.passed = true;
}

main().then(() => {
  fs.writeFileSync(path.join(root, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', {mode: 0o600});
  console.log(JSON.stringify({passed: true, privateReceipt: path.join(root, 'receipt.json'), distinctParents: receipt.parents.length}));
}).catch(error => {
  receipt.failure = String(error.message).slice(0, 500);
  try { restoreOnlyTestchain(); } catch (restoreError) { receipt.restoreFailure = String(restoreError.message).slice(0, 500); }
  fs.writeFileSync(path.join(root, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', {mode: 0o600});
  console.error(JSON.stringify({passed: false, failure: receipt.failure, privateReceipt: path.join(root, 'receipt.json'), ...(receipt.restoreFailure ? {restoreFailure: receipt.restoreFailure} : {})}));
  process.exitCode = 1;
}).finally(() => { process.umask(previousUmask); });
