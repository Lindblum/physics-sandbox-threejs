# Physics Sandbox

Pick up, throw and stack solid cubes and spheres of ten materials on a floating disc, on a desktop, in stereo 3D, or in WebXR (VR, passthrough AR, phone viewers).

Live: https://lindblum.github.io/physics-sandbox-threejs/

Built with [three.js](https://threejs.org), React, [@react-three/fiber](https://r3f.docs.pmnd.rs), [@react-three/xr](https://pmndrs.github.io/xr/), [@react-three/rapier](https://github.com/pmndrs/react-three-rapier) and Vite.

## Run

```sh
npm install
npm run dev        # http://localhost:5176, with a Quest 3 emulator on localhost
npm run dev:xr     # HTTPS on your LAN, for a real headset or phone
npm run build      # static site in dist/ (relative paths, any host)
npm run preview    # the build, on http://localhost:5276
```

## The sandbox

- The floor is a solid disc, 1 m across the radius and 10 cm thick. Gravity doesn't move it and it can't be picked up.
- Ten cubes start 10 cm above it, one of each material: Wood (Oak), Steel, Rubber, Ice, Glass, Granite, Foam, Aluminium, Gold and Plastic. Each has its own density (so mass), friction and bounce.
- An object you pick up shows its material over it.
- Anything that falls off the disc is gone; one of the first ten comes back above the disc.

## Options

| Setting | Choices |
| --- | --- |
| Physics | Gravity On / Off, Simulation Running / Paused, Reset Objects |
| Video | Background (Solid, Skybox, Passthrough), View Mode, VSync, XR Resolution |
| Accessibility | Text Size, Controller Guide |
| Tools (its own panel) | Select (pick up), Cube, Sphere (make one, of a random material) |

## Controls

| | Desktop | XR |
| --- | --- | --- |
| Pick up and throw | Select: drag an object, let go while moving; the wheel moves it nearer / further | Grip: what the probe (the orange ball at the controller's tip) touches, or what you point at; Select + trigger drags too |
| Make a cube / sphere | Cube / Sphere: click the disc or an object | Cube / Sphere: point and pull the trigger |
| Held object | | Thumbstick up / down pushes it away / reels it in, left / right rolls it |
| Orbit / zoom, move | Drag / scroll | Walk; left stick moves, right stick turns |
| Panels | `Enter` / `Esc` toggles Options; `1` `2` `3` tools, `G` gravity, `P` pause, `R` reset | Options docks on the left controller, View and Tools on the right; hold a grip on a panel to move it, tap twice to dock / undock, three times to bring them all |

## Layout

- `src/Physics.jsx`, `src/materials.js`: the disc, the objects, their materials, holding and throwing, the material labels
- `src/Scene.jsx`, `src/App.jsx`: the scene and the tools, app state, keyboard and windowed panels
- `src/menu.js`, `src/XRMenuPanel.jsx`: the shared panels (Options, View, Tools) and their XR (canvas) panels
- `src/Grab.jsx`, `src/grip.js`: grips, controller probes and panel docking
- `src/SideBySide.jsx`, `src/Interlaced.jsx`: windowed stereo views
- `src/PhoneStereo.jsx`, `src/Cardboard.jsx`, `src/CardboardLens.js`, `src/Gaze.jsx`: phone XR, phone viewers and gaze dwell-to-click
