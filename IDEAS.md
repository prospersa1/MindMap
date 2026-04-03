# MindMap — Future Ideas

A running list of ideas to revisit and implement later.

---

## 🌅 Dynamic Time-of-Day Background Scene

Instead of a static Unsplash photo, generate or render a scene that shifts based on the time of day — creating an ambient, living backdrop for the new tab.

**Concept:**
- Early morning (5am–8am) → deep blue horizon, stars fading, sun just cresting
- Morning (8am–12pm) → bright sky, soft clouds, warm light
- Afternoon (12pm–5pm) → full daylight, high contrast
- Evening (5pm–8pm) → golden hour, orange/pink gradient
- Night (8pm–5am) → dark sky, stars, moon

**Possible approaches:**
- CSS/canvas gradient that interpolates smoothly between colour palettes as time progresses
- Three.js scene (already used in the AR module) with a sky shader — sun position driven by real time
- Use a curated Unsplash collection per time-of-day category instead of fully random (`/photos/random?collections=...`)

**Why it's interesting:**
The new tab is opened dozens of times a day. A background that subtly shifts with the sun makes the page feel alive and grounded in the real world — reinforcing the MindMap theme of being present and aware.

---

*More ideas to be added here as they come up.*
