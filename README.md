# TRACE

Project page and interactive demo for **TRACE: A Two-Channel Robust Attribution
Watermark via Complementary Embeddings for LLM-Agent Trajectories**
([arXiv:2607.08400](https://arxiv.org/abs/2607.08400)).

**Live site:** https://trace-hse.github.io/trace/

TRACE hides two complementary watermarks in an AI agent's behaviour trajectory,
so provenance survives even when the party holding the log deletes or rewrites
records. A Tech4HSE project (CSIRO's Data61 × UNSW).

## What's in this repo

- `demo/web/` — the project website (landing page) and the interactive demo UI
  (React + Vite + TailwindCSS). This is what GitHub Pages serves.
- `.github/workflows/deploy-pages.yml` — builds and deploys the site on push.
- `demo/hse/cases/` — the two synthetic fixtures used by frontend tests.

The paper's core watermarking implementation and the demo's Python backend are
not part of this repository.

## The interactive demo

Industrial Safety (HSE) is the default scenario. Household Tasks and General
Attack Scenarios remain available in the Scenarios menu. Saved runs play
directly from static files without a Python backend or model API.

The two current HSE PPE cases each contain a 24-action inspection with and
without watermarking. Both workflows share an interactive 3D scene. The
What changed? box starts collapsed to leave room for the animation; expand it
to compare illustrated choices, replay saved decisions with public demo keys,
and view the reported task-success comparison. Collapsing it preserves the key
and replay result. Key replay is available as soon as the case loads and does
not require watching the full inspection first.

Key replay uses the exported results of the original sampler at each recorded
decision state. It is separate from statistical watermark detection and does
not execute a new model or establish a unique identity. The HSE observations
and 3D scene are synthetic, and the method illustrations are not site evidence.

Live model execution still requires a separately configured backend. This
repository publishes the website and saved demonstrations, not that service.

## Develop locally

Use Node.js 24 (minimum 22.12) and npm 10.5.1 or newer.

```bash
cd demo/web
npm ci
npm test
npm run build
npm run dev
```

Open the URL printed by Vite (normally http://localhost:5173).

For deployment under a subdirectory, set the base path when building, for
example `BASE_PATH=/trace/ npm run build`. The Pages workflow supplies the
repository-specific path automatically.
