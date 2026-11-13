'use strict';
// Compatibility entry: the original Electron fixture started normal main and
// now conflicts with the App's global single-instance guard. Its meaningful
// assertions live in the headless production Session/UI fixture below.
// Mapping: work/owner-remark-management-ui-draft/LEGACY_MAPPING.md.
// Do not add this invocation to the new suite's count as a separate run.
if(process.env.ARCADE_UI_PREFIX){
  const prefix=process.env.ARCADE_UI_PREFIX;
  if(!/^[a-z0-9-]{1,72}$/.test(prefix))throw Error('Use a filename-only prefix.');
  process.argv[2]=`outputs/${prefix}`;
}
require('./qq-owner-remark-management-ui-smoke.cjs');
