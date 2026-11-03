# Make a theme

Copy `src/themes/workshop.json`, edit it, and use **Settings & themes → Import a theme**. No build step is required. One custom theme is stored locally at a time; importing another replaces it.

```json
{
  "version": 1,
  "name": "My workshop",
  "author": "Your name",
  "colors": {
    "sky": "#EDF2E7", "floor": "#DCE6D2",
    "accent": "#EFB856", "ink": "#243C37"
  },
  "palette": { "a": "#90AF83", "d": "#385044" },
  "sprites": { "idle": ["................"] }
}
```

The example above is abbreviated, **not** importable. Use the complete built-in theme as your template. Every sprite must contain **16 strings of 16 characters**. A dot is transparent; any other character refers to a single lower-case letter or digit in `palette`. Supply all seven sprites: `idle`, `running`, `waiting`, `error`, `done`, `unknown`, `ended`. Palette maximum: 20 colors, each a six-digit hex value. File maximum: 32 KB. Name maximum: 50 characters.

The app supplies construction/attention/smoke/parcel scenery and animations. You control character pixels and scene colors; semantic labels remain consistent. This makes themes reviewable and keeps a theme from lying about an agent's state. Respect reduced motion, avoid low-contrast characters, and use original artwork.

Include a screenshot, author, theme JSON, and MIT license statement in a theme pull request. Original Sprout Bot source is `scripts/create-assets.cjs`; running it regenerates the two built-ins and banner.
