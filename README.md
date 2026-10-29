# Physics Sandbox

Pick up, throw and stack solid cubes and spheres of thirty materials on a floating disc, hearing them knock, ring and scrape, on a desktop, in stereo 3D, or in WebXR (VR, passthrough AR, phone viewers).

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

- The floor is a solid concrete disc, 1 m across the radius and 10 cm thick. Gravity doesn't move it and it can't be picked up.
- Ten cubes start 10 cm above it: Wood (Oak), Steel, Rubber, Ice, Glass, Granite, Foam, Aluminium, Gold and Plastic. Each has its own density (so mass), friction and bounce.
- Cube and Sphere make one of the Material chosen in Tools, or a random one.
- An object you pick up shows its material over it.
- Everything moves through air: it drags (foam and cotton drift down), and buoys things up, so Smoke and Steam rise. Gases pass through things. Liquids are rigid blobs for now.
- Things that strike or slide on each other sound like what they're made of, louder and brighter the harder and heavier, from where they are (see below).
- Anything that falls off the disc or floats away is gone; one of the first ten comes back above the disc.

## Materials

`src/materials.csv` is the table: a row a material, a column a property. Add a column and every material has it (`material.row.<column>` in code); add a row and it's in the Material dropdown. 30 so far: Air, Smoke, Steam, Water, Oil, Honey, Ice, Snow, Oak, Pine, Cardboard (hollow), Paper, Cloth (hollow), Cotton, Leather (hollow), Rubber, Foam, Plastic, Glass, Ceramic, Brick, Concrete, Granite, Marble, Clay, Iron, Steel, Aluminium, Copper, Gold.

| Columns | |
| --- | --- |
| `state`, `density_kg_m3`, `fill` | solid / liquid / gas; mass is density × fill × volume (a hollow thing is mostly air) |
| `friction`, `restitution` | sliding and bounce (friction by the lesser of two surfaces, bounce by their average) |
| `color` … `clearcoat` | the look: colour, metalness, roughness, opacity, transmission, index of refraction, sheen, clearcoat |
| `impact_*`, `scrape_*` | the synthesized sounds: a 10 cm object's ring (pitch, ring time, partials, noise, brightness, loudness) and its sliding hiss |
| `youngs_modulus_gpa` … `speed_of_sound_m_s` | for simulations to come: stiffness, melting and boiling points, specific heat, conductivity, viscosity, speed of sound |

## Sound

Synthesized live (Web Audio, `src/sound.js`), no recordings. A strike rings both things: a few decaying partials at the material's pitch (lower for bigger things) plus a burst of noise, as loud as the hit's speed × √mass and brighter the harder it is. Sliding hisses through a band around both materials' scrape pitch, louder the faster and harder it presses; a rolling ball rumbles. Each sound comes from where it happens, in XR too.

## Files

Options → File → Save Scene downloads a `.glb` (glTF 2.0): the disc, every object where it is, their PBR materials (glass and water see-through with their index of refraction) and the sun. Blender opens it with File → Import → glTF 2.0; each object's material, mass, density, friction, bounce and velocity are in its Custom Properties. Open Scene loads one back (one saved here, or re-exported from Blender with custom properties included).

## Options

| Setting | Choices |
| --- | --- |
| File | Save Scene (.glb), Open Scene (.glb) |
| Physics | Gravity On / Off, Simulation Running / Paused, Sound On / Off, Reset Objects |
| Video | Background (Solid, Skybox, Passthrough), View Mode, VSync, XR Resolution |
| Accessibility | Text Size, Controller Guide |
| Tools (its own panel) | Tool: Select (pick up), Cube, Sphere (make one); Material: Random or any of the 30 |

## Controls

| | Desktop | XR |
| --- | --- | --- |
| Pick up and throw | Select: drag an object, let go while moving; the wheel moves it nearer / further | Grip: what the probe (the orange ball at the controller's tip) touches, or what you point at; Select + trigger drags too |
| Make a cube / sphere | Cube / Sphere: click the disc or an object | Cube / Sphere: point and pull the trigger |
| Held object | | Thumbstick up / down pushes it away / reels it in, left / right rolls it |
| Orbit / zoom, move | Drag / scroll | Walk; left stick moves, right stick turns |
| Panels | `Enter` / `Esc` toggles Options; `1` `2` `3` tools, `G` gravity, `P` pause, `M` sound, `R` reset | Options docks on the left controller, View and Tools on the right; hold a grip on a panel to move it, tap twice to dock / undock, three times to bring them all |

## Layout

- `src/materials.csv`, `src/materials.js`: the materials table and its reader
- `src/Physics.jsx`: the disc, the objects, holding and throwing, air drag, the material labels, which contacts make which sounds
- `src/sound.js`: the sounds' synthesis
- `src/sceneFile.js`: saving and opening scenes (.glb)
- `src/Scene.jsx`, `src/App.jsx`: the scene and the tools, app state, keyboard and windowed panels
- `src/menu.js`, `src/XRMenuPanel.jsx`: the shared panels (Options, View, Tools) and their XR (canvas) panels
- `src/Grab.jsx`, `src/grip.js`: grips, controller probes and panel docking
- `src/SideBySide.jsx`, `src/Interlaced.jsx`: windowed stereo views
- `src/PhoneStereo.jsx`, `src/Cardboard.jsx`, `src/CardboardLens.js`, `src/Gaze.jsx`: phone XR, phone viewers and gaze dwell-to-click
