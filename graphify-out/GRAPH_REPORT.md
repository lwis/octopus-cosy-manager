# Graph Report - octopump  (2026-08-01)

## Corpus Check
- 6 files · ~8,554 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 136 nodes · 251 edges · 11 communities (10 shown, 1 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `662455ef`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]

## God Nodes (most connected - your core abstractions)
1. `OctopusClient` - 20 edges
2. `esc()` - 11 edges
3. `renderDashboard()` - 11 edges
4. `showDashboard()` - 10 edges
5. `run()` - 9 edges
6. `renderCurveSvg()` - 9 edges
7. `toast()` - 7 edges
8. `hideAllViews()` - 7 edges
9. `repaintCurve()` - 7 edges
10. `confirmAction()` - 6 edges

## Surprising Connections (you probably didn't know these)
- `init()` --calls--> `isCompact()`  [EXTRACTED]
  js/app.js → js/app.js  _Bridges community 3 → community 2_
- `confirmAction()` --calls--> `esc()`  [EXTRACTED]
  js/app.js → js/app.js  _Bridges community 6 → community 5_
- `renderCurveSheet()` --calls--> `esc()`  [EXTRACTED]
  js/app.js → js/app.js  _Bridges community 6 → community 10_
- `renderDashboard()` --calls--> `esc()`  [EXTRACTED]
  js/app.js → js/app.js  _Bridges community 6 → community 2_
- `renderSchematicCompact()` --calls--> `esc()`  [EXTRACTED]
  js/app.js → js/app.js  _Bridges community 6 → community 7_

## Import Cycles
- None detected.

## Communities (11 total, 1 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.08
Nodes (22): addGroup(), CURVE, dayInitials, dayNames, dialog, finishSetup(), handleSetup(), linkState (+14 more)

### Community 2 - "Community 2"
Cohesion: 0.19
Nodes (13): activeZones(), bindCurve(), bindCurveProbe(), initCurveState(), isCompact(), readAge(), renderBranches(), renderDashboard() (+5 more)

### Community 3 - "Community 3"
Cohesion: 0.24
Nodes (12): hideAllViews(), init(), loadCredentials(), logout(), removeGroup(), saveCurve(), showDashboard(), showPerformanceHistory() (+4 more)

### Community 4 - "Community 4"
Cohesion: 0.18
Nodes (10): Brief, Cosy 6 — plant sheet redesign, Curve, Decisions worth recording, Direction, Scope, Signature, Structure (+2 more)

### Community 5 - "Community 5"
Cohesion: 0.29
Nodes (10): confirmAction(), openDialog(), promptForText(), renameSensor(), renameZone(), run(), setPrimarySensor(), setupSmartControl() (+2 more)

### Community 6 - "Community 6"
Cohesion: 0.27
Nodes (10): addSlot(), circuitLabel(), circuitVar(), esc(), renderSlotRow(), renderZoneSheet(), showEditZone(), showZoneOverride() (+2 more)

### Community 7 - "Community 7"
Cohesion: 0.32
Nodes (8): baseline(), isSentinel(), num(), renderSchematicCompact(), renderSchematicWide(), schematicFigures(), schematicLabel(), temp()

### Community 8 - "Community 8"
Cohesion: 0.29
Nodes (5): API Requirements, Core Structure, Design rules, Key Behaviors & Conventions, Project Architecture

### Community 9 - "Community 9"
Cohesion: 0.29
Nodes (6): Cosy 6 — heat pump control, GitHub Pages, Privacy, Project structure, Running locally, What it does

### Community 10 - "Community 10"
Cohesion: 0.33
Nodes (9): clamp(), curveIsDirty(), curveTempFromX(), curveX(), curveY(), policyFlowAt(), policyPath(), renderCurveSheet() (+1 more)

## Knowledge Gaps
- **33 isolated node(s):** `viewLoading`, `viewSetup`, `viewDashboard`, `viewEditZone`, `viewZoneOverride` (+28 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `OctopusClient` connect `Community 1` to `Community 0`?**
  _High betweenness centrality (0.193) - this node is a cross-community bridge._
- **What connects `viewLoading`, `viewSetup`, `viewDashboard` to the rest of the system?**
  _33 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.07635467980295567 - nodes in this community are weakly interconnected._