# C2 brand assets

`mascot-c2.svg` is the editable source of truth: a blue cat head, shallow V notch in the viewer-left ear, a shorter intact right ear, a navy face mask, and two off-white pill eyes. It uses solid fills without gradients or shadows.

Run from the repository root:

```sh
pnpm icons:generate
pnpm icons:check
```

Generation requires the installed workspace dependencies (`sharp` and the desktop Tauri CLI). It writes transparent UI marks and browser favicons, desktop PNG/ICO/ICNS icons, Windows logos, opaque iOS and Apple touch icons, Android launcher/adaptive/themed icons, single-color tray marks, and Android notification drawables. ICO and ICNS are encoded by Tauri, not PNG files with renamed extensions. `--check` compares regenerated assets without modifying them.

`BrandMark` draws inline SVG paths from the generated `brand-shapes.generated.ts`, so UI icons stay vector at any display density and are bundled with the application. Its `monochrome` variant uses an even-odd compound path with transparent eye cutouts and `currentColor` for navigation, hover, selection, and dark mode. The sidebar Claudia destination uses this variant with a tighter viewBox to reduce unused padding at small sizes. Both variants are generated from the master without image loading or CSS masks. Public SVG and legacy PNG filenames remain generated compatibility assets. `assets/zclaudia.svg` and the desktop `app-icon.svg`/`app-icon.png` are generated from the same master as well.

Android foregrounds include padding for adaptive masks. API 33 resources include a monochrome layer for themed icons. Notification icons are separate white alpha silhouettes at 24dp. The Android build copies the tracked icon resources to its generated project and then derives the DEV-badged launcher variants; do not edit generated Android resources as the source of truth.

The tray uses the black alpha silhouette with cutout eyes as a macOS template image. White variants are also generated for consumers that need them.

`mascot-c2-flat.png` is the generated 1024px transparent production export. `mascot-c2.png` and `mascot-c2.prompt.txt` preserve the original image-generation design draft and its provenance; production assets are rendered from the SVG, not that draft.
