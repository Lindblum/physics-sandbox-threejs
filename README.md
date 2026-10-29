# Physics Sandbox

Pick up, throw and stack real-size solids (cubes, spheres, Platonic, Catalan and stellated polyhedra) of 46 materials, real and fictional, liquids that pour and sand that heaps, on a disc at your feet, hearing them knock, ring and scrape, some glowing, smoking or burning, on a desktop, in stereo 3D, or in WebXR (VR, passthrough AR, phone viewers).

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

- Everything is real size: the floor is a solid concrete disc, 1 m across the radius and 10 cm thick, its top the floor you stand on in XR. Gravity doesn't move it and it can't be picked up.
- In XR, hold both grips in mid-air (no object at either probe) and move your hands apart or together to scale the scene, and turn them to turn it, about your hands' midpoint, as in Tilt Brush. The scale shows in Options' top-right corner (press it for real size). It's you that changes size, so the physics doesn't.
- Ten cubes start 10 cm above it: Wood (Oak), Steel, Rubber, Ice, Glass, Granite, Foam, Aluminium, Gold and Plastic. Each has its own density (so mass), friction and bounce.
- The shape tools make one of the Material chosen in Tools, or a random one: Cube (10 cm), Sphere (10 cm), Cylinder (10 cm), Torus (14 cm), Tetrahedron, Octahedron, Icosahedron, Dodecahedron, Stellated Dodecahedron, Stellated Icosahedron, Rhombic Dodecahedron, Truncated Octahedron, Rhombic Triacontahedron (15 cm across their points). The stellated ones collide as what they are: a core with a pyramid on each face.
- An object you point at, or pick up, shows its material and mass over it.
- With a shape tool (or Paste), a wireframe shows where it would go: on the surface under the mouse, or in XR on the surface a controller points at, or round its probe when it points at nothing. A click, or the trigger, makes it there.
- Copy takes an object (its shape, material and size), Paste makes more like it, Delete takes one away.
- In XR, grip an object you're holding with your other hand too (its probe on it) to turn and resize it: it follows your hands, turns with them, and grows or shrinks with the distance between them. Hold a trigger to stretch it only along the line between the probes. It keeps its new size and shape, collider and mass included (and in saved scenes).
- The controller buzzes softly while its probe touches an object (not while its grip is held), and as hard as a held object strikes something, softly while it slides.
- Everything moves through air: it drags (foam and cotton drift down), and buoys things up, so Smoke and Steam rise. Gases and plasmas pass through things; Fire, Plasma and Unobtainium hover where they're left; heavy Fog sinks and spreads over the floor; Haze hangs in the air, drifting; Dander's flakes flutter down and settle. Gelatin and Flubber wobble when struck; wet Clay squashes where it strikes things, and stays squashed; Glue sticks to whatever it touches, the floor too, until pulled apart.
- Water, Oil, Honey, Mercury and Sand are simulated as grains (`src/Fluids.jsx`): a shape of them is several hundred small bodies that pour, splash, puddle and heap, and push and are pushed by the objects. Liquids' droplets cling together (Mercury beads up) and drag on each other (Honey is slow), drawn as one smooth surface round them (metaballs); Sand's grains are angular (little boxes, drawn as pebbles), so they interlock and heap. Cloth is a sheet: a grid of points held by threads, which falls, drapes over things and folds, and the mouse can pick up. Up to 2400 grains at once (the oldest pours go). Their names say so: (Fluid), (Particle).
- Glowing materials (Lava, Fire, Plasma, Kryptonite, Glow-in-the-Dark Plastic, Unobtainium) light what's around them: the four nearest you at once.
- Particles: Smoke, Steam and Fire give off smoke, steam and flames, Lava sparks, glowing things motes; Sand and Snow throw up dust where they're struck, liquids splash.
- Things that strike or slide on each other sound like what they're made of, louder and brighter the harder and heavier, from where they are (see below).
- Anything that falls off the disc or floats away is gone; one of the first ten comes back above the disc.

## Materials

`src/materials.csv` is the table: a row a material, a column a property. Add a column and every material has it (`material.row.<column>` in code); add a row and it's in the Material dropdown. 46 so far: Air, Smoke, Steam, Heavy Fog, Haze, Dander, Water, Vegetable Oil, Honey, Ice, Snow, Oak, Pine, Cardboard, Paper, Cloth, Cotton, Leather, Rubber, Foam, Plastic, Glass, Ceramic, Brick, Concrete, Granite, Marble, Clay, Iron, Steel, Aluminium, Copper, Gold, Mercury, Sand, Gelatin, Silicone, Glue, Lava, Fire, Plasma, Glow-in-the-Dark Plastic, and the fictional Flubber, Kryptonite, Mithril and Unobtainium.

| Columns | |
| --- | --- |
| `state`, `density_kg_m3`, `fill` | solid / liquid / gas; mass is density × fill × volume (a hollow thing is mostly air) |
| `friction`, `restitution` | sliding and bounce (friction by the lesser of two surfaces, bounce by their average) |
| `color` … `clearcoat` | the look: colour, metalness, roughness, opacity, transmission, index of refraction, sheen, clearcoat |
| `emissive`, `emissive_intensity`, `emissive_pattern`, `light_cd` | glow (all over, or only in the texture's hollows, as lava's cracks), and the light it casts |
| `luster`, `reflectance` | its kind of shine (metallic, vitreous, resinous, waxy, …) and how much a non-metal mirrors |
| `texture`, `texture_scale_m`, `normal_strength`, `pattern_contrast`, `roughness_variance` | its surface: a procedural pattern (grain, brushed, hammered, speckle, veins, cracks, crystal, weave, pores, …) at real size, its bumps, how it shades the colour and varies the roughness |
| `color_variance` | how much one object's colour differs from the next |
| `restitution_combine`, `gravity_scale`, `damping`, `jiggle` | bounciness off anything (Flubber), hovering, settling, wobbling |
| `collides`, `sticky`, `plasticity` | what it bumps into (all, the floor only, nothing), whether it glues itself to what it touches, whether it stays squashed where struck |
| `simulation`, `grain_count`, `sim_cohesion`, `sim_viscosity` | made of grains (liquid, granular or cloth), how many in a 10 cm cube's worth (cloth: in its sheet), how they cling and drag |
| `particles`, `particle_rate`, `impact_particles` | what it gives off, how much, and what flies where it's struck |
| `impact_*`, `scrape_*` | the synthesized sounds: a 10 cm object's ring (pitch, ring time, partials, noise, brightness, loudness) and its sliding hiss |
| `youngs_modulus_gpa` … `speed_of_sound_m_s` | for simulations to come: stiffness, melting and boiling points, specific heat, conductivity, viscosity, speed of sound |

## Sound

Synthesized live (Web Audio, `src/sound.js`), no recordings. A strike rings both things: a few decaying partials at the material's pitch (lower for bigger things) plus a burst of noise, as loud as the hit's speed × √mass and brighter the harder it is. Sliding hisses through a band around both materials' scrape pitch, louder the faster and harder it presses; a rolling ball rumbles. Each sound comes from where it happens, in XR too.

## Files

Options → File → Save Scene downloads a `.glb` (glTF 2.0): the disc, every object where it is, their PBR materials with their textures (glass and water see-through with their index of refraction, glowing things emissive) and the sun. Blender opens it with File → Import → glTF 2.0; each object's material, mass, density, friction, bounce and velocity are in its Custom Properties. Open Scene loads one back (one saved here, or re-exported from Blender with custom properties included).

## Options

| Setting | Choices |
| --- | --- |
| File | New Scene (an empty disc), Save Scene (.glb), Open Scene (.glb) |
| Physics | Gravity On / Off, Simulation Running / Paused, Reset Objects |
| Video | Background (Solid, Skybox, Passthrough), View Mode, Show Grid (every 10 cm over the disc, up to 2 m), VSync, XR Resolution, and the costly effects, each to turn down where frames run short: Reflections, Refraction (off at first in a headset), Shadows, Glow Lights, Surface Detail, Liquid Surfaces (Smooth metaballs / Droplets), Particles (High / Low) |
| Accessibility | Volume, Vibration (to 200%), Text Size, Controller Guide |
| Tools (its own panel) | Tool: Select (pick up), Copy, Paste, Delete, or a shape (make one); Material: Random or any of the 46 |

## Controls

| | Desktop | XR |
| --- | --- | --- |
| Pick up and throw | Middle button (any tool), or Select's left: drag an object, let go while moving; the wheel moves it nearer / further |
| Stretch an object | Shift + middle-drag: along the drag, out longer, in shorter (its far side stays put) | Grip: what the probe (the orange ball at the controller's tip) touches, or what you point at; Select + trigger drags too |
| Make a shape | Pick it in Tools, click the disc or an object (its wireframe shows where) | Point at a surface, or at nothing (round the probe), and pull the trigger |
| Copy, Paste, Delete | Click an object; Paste: click where it goes | Point and pull the trigger |
| Scale the scene | | Both grips in mid-air: hands apart / together, turn them |
| Turn / resize an object | | Hold it, grip it with the other probe too; a trigger: stretch along the hands' line |
| Held object | | Thumbstick up / down pushes it away / reels it in, left / right rolls it |
| Orbit / zoom, move | Drag / scroll | Walk; left stick moves, right stick turns |
| Panels | `Enter` / `Esc` toggles Options; `1` … `9`, `0` tools, `G` gravity, `P` pause, `M` mute, `R` reset | Options docks on the left controller, View and Tools on the right; hold a grip on a panel to move it, tap twice to dock / undock, three times to bring them all |

## Layout

- `src/materials.csv`, `src/materials.js`: the materials table and its reader
- `src/shapes.js`: the shapes, their colliders and icons
- `src/textures.js`: the materials' procedural surfaces
- `src/particles.js`: the particles
- `src/Fluids.jsx`, `src/Cloth.jsx`: liquids and sand, as grains, and cloth, as a sheet
- `src/Physics.jsx`: the disc, the objects, holding and throwing, air drag, glow lights, the material labels, what contacts do
- `src/sound.js`: the sounds' synthesis
- `src/sceneFile.js`: saving and opening scenes (.glb)
- `src/Scene.jsx`, `src/App.jsx`: the scene and the tools, app state, keyboard and windowed panels
- `src/menu.js`, `src/XRMenuPanel.jsx`: the shared panels (Options, View, Tools) and their XR (canvas) panels
- `src/Grab.jsx`, `src/grip.js`: grips, controller probes, scaling the scene and panel docking
- `src/SideBySide.jsx`, `src/Interlaced.jsx`: windowed stereo views
- `src/PhoneStereo.jsx`, `src/Cardboard.jsx`, `src/CardboardLens.js`, `src/Gaze.jsx`: phone XR, phone viewers and gaze dwell-to-click
