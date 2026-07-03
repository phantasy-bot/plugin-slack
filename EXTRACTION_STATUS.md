# @phantasy/plugin-slack

- Repo URL: https://github.com/phantasy-bot/plugin-slack
- Extraction phase: `source-extracted`
- Source of truth: `monorepo`
- Runtime load mode: `git`
- Source owner: `monorepo`
- Source payload: `source-extract`
- Monorepo package status: `removed`
- Sync mode: `source-extract`

## Meaning

This repo now receives a true source extraction payload from the main Phantasy monorepo. It should continue severing deep internal dependencies until the standalone repo becomes fully independent.

## Next Step

Continue replacing remaining monorepo-coupled imports with stable public package contracts, then publish from this repo directly.
