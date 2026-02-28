# Landscaper

Landscaper is a browser-based layout tool for planning outdoor spaces. Users upload a top-down image, create reusable landscape elements, and stamp/move/resize those elements on a canvas.

# Live Demo

A live demo can be found at https://unislash.github.io/landscaper/

## Quick Start

1. Install dependencies:

   ```bash
   yarn install
   ```

2. Run the dev server:

   ```bash
   yarn dev
   ```

3. Build for production:

   ```bash
   yarn build
   ```

## Key Docs

- Product and technical scope: `DesignDoc.md`

## Current Persistence Model

- Save/load is local-only during this phase.
- Plans are stored in browser local storage (`landscaper.plans.v1`).
- No backend/cloud sync yet.
