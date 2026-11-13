# Whale Girl — anime RPG portrait revision

Created **2026-11-04** with the built-in image generation tool. The owner selected Japanese anime RPG / moe character portraits with distinctive accessories, refined costumes, lively expressions and detailed cel shading. No Bothouse or other third-party illustration was submitted to generation. The first original generated portrait was used only for one composition edit to restore headpiece margin.

## Delivered asset

- Project file: `src/ui/portraits/deepseek-whale-anime-v2.png`
- Selected generated source: `exec-da8d7cfa-83a8-47f4-89d6-f51e7c57e29e.png`
- Initial generation source: `exec-010c8608-df20-467a-9b83-8273ed3748c4.png`
- Output: PNG, 1254 × 1254, 32-bit RGBA, 1,988,476 bytes.
- SHA-256: `5bb08ca6381bd5cf85902bda017a6839fdd0603060ec5d0df99ffc6e3ffb9cdc`
- Copied unchanged from the generated file. The earlier `deepseek-whale.png` remains untouched.

Read-back with System.Drawing confirmed alpha 0 in all four corners. The selected local PNG was opened and visually inspected: one blue-haired character, whale-fin ornaments and blue bows, bright eyes and a playful smile, a sapphire brooch and a covered navy/white lace uniform. The composition correction adds clear space above the headpiece. Actual circular-avatar legibility belongs to the integration UI check; the source inspection does not establish it alone.

## Exact generation prompt

```text
Use case: stylized-concept. Asset type: a new original square transparent avatar for Agent Arcade, DeepSeek-themed Whale Girl, for a light anime chat app. Primary request: Japanese anime RPG / gacha-game moe character portrait with a distinctive character identity, exquisite costume detail, lively expression, fine layered cel shading, and signature accessories. Subject: exactly one clearly adult young woman with long deep-ocean-blue hair, luminous blue eyes, a slightly mischievous bright smile and subtle head tilt. Her signature hair ornaments are a pair of elegant whale-fin-shaped blue ornaments with neatly tied blue ribbons. Outfit: original detailed marine-inspired fantasy maid uniform, high white lace collar, covered shoulders with delicate white ruffles, a small sapphire brooch, restrained gold piping, deep navy and white palette; modest fully covered neckline, no sexualized pose. Art: fine crisp expressive linework, polished layered cel shading, luminous glossy strands of hair, nuanced eyes and cheerful personality; premium Japanese 2D game character illustration, not photorealistic, not 3D, not a baby or chibi. Composition: centered head-and-shoulders close portrait almost front-facing, the face approximately 50% of image height, the entire hair silhouette and ornaments inside the central circular crop-safe region with at least 8% transparent margin around the head; clear face and whale motifs readable at 40 pixels. Background: genuine transparent alpha only, no setting, no panel or circle, no checkerboard pattern, no graphic shadow. Constraints: independent original face, ornament and costume design; no copy of an existing character or artwork; no provider logos, no lettering, no text, no watermark, no extra character, no hands or props.
```

## Exact composition edit prompt

The only input image was the original generated `exec-010c8608-df20-467a-9b83-8273ed3748c4.png`. Transparency remained enabled.

```text
Use case: precise-object-edit. Edit target: this original blue-haired whale-girl anime portrait. Change composition only: zoom the complete illustration out by about 18 percent, centered horizontally, so there is a clearly visible transparent margin of about 8 percent of the square canvas above the entire white headpiece and on both sides of the whale-fin hair ornaments. Complete the topmost lace edge if needed so no part of the headpiece is cut off. Keep the same character face, bright expression, head tilt, all hair colors, eye colors, whale ornaments, ribbons, sapphire brooch, fully covered ornate blue-and-white maid outfit, linework and detailed cel shading. Preserve transparent background. Keep head-and-shoulders avatar composition and square canvas; lower chest may end at the bottom naturally. Do not enlarge the head. Do not add objects, scene, shadows, logos, text or watermarks.
```
