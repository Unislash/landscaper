# Landscaper

Landscaper is a browser-based layout tool for planning outdoor spaces. Users upload a top-down image, create reusable landscape elements, and stamp/move/resize those elements on a canvas.

I created this little application because I wanted to use it for my own landscaping project. I currently do not have any plans to monetize this application, so if you happen to have found it and want to use it for your own designs, I would love nothing more!

Enjoy.

## Live Demo

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

## Current Persistence Model

- Plans are stored in browser local storage (`landscaper.plans.v1`).
- No backend/cloud services.

## A note to code spelunkers

This was one of the first "vibe coded" applications that I've made. It was made with Codex, and was a project that I very intentionally *did not read any of the code* for. Which, to be honest... for me was very hard to keep myself from doing. So with that said, I apologize; it's absolutely going to read like a naively vibecoded app (because it is).