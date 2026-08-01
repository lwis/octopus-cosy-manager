# Cosy 6 — plant sheet redesign

Date: 2026-07-31

## Brief

Restyle the whole app. Direction: instrument panel, not Octopus house style and not a
consumer thermostat app. Desktop and phone matter equally. The page's job: show what the
heat pump is doing right now, and let the owner change it.

## Direction

One plotted sheet. The dashboard is a single continuous drawing: a live plant schematic
(what it is doing) whose flow line drops into the axis of the weather-compensation curve
(what policy tells it to do).

### Tokens

| token | hex | job |
|---|---|---|
| `--zinc` | `#d7dddb` | ground, carries the plotted grid |
| `--sheet` | `#edf0ef` | panels |
| `--ink` | `#16211f` | lines and type; greys are ink at opacity |
| `--heat` | `#c4462a` | heating circuit |
| `--water` | `#17607f` | hot water circuit |
| `--aux` | `#a07b12` | auxiliary circuits |

Rule: saturated colour appears only where a circuit is moving heat. Satisfied circuits are
hairline ink; off circuits are ink at 25%.

### Type

- Archivo variable (self-hosted). `wdth` 74–82 uppercase for zone names, headings, and the
  masthead; normal width for prose.
- IBM Plex Mono, tabular figures, for every number, every label plate, and every button.

### Signature

The energy balance schematic. Outdoor air enters, the pump box shows RUN or IDLE, and the
flow line runs out to the circuits, round the loop, and down into the curve below. Inside
that loop, electricity in and heat out are drawn as bars on one shared kW-per-pixel scale,
so efficiency is legible as a length ratio before the COP number is read. Dash animation on
the flow line scales with heat output and stops when the pump stops.

### Curve

Weather compensation plotted as flow temperature against outdoor temperature, with the live
operating point on it. Endpoint handles are draggable and keyboard-operable (arrows, shift
for ×5), clamped to the API's allowable ranges. The saved policy stays visible as a dashed
ghost while the draft differs. Nothing is written until Save. Fixed flow temperature is the
same control with one handle and a flat line.

## Structure

No decorative numbering. Structural devices are plant vernacular: mono label plates,
hairline rules only at real boundaries, circuit tags, and a day-mask grid for schedules.

## Scope

- `css/style.css` rewritten as a token-based design system.
- `index.html` reshaped: masthead with a connection lamp, sheets, toast host, shared dialog.
- `js/app.js` renders the schematic, the curve, circuit branches, zone sheets, the schedule
  editor, overrides, and 14-day history. `alert`/`confirm`/`prompt` replaced with toasts and
  a native `<dialog>`. Kept as one file at the owner's request.
- Fonts self-hosted so the app makes no third-party requests.
- `debug/preview.html` + `debug/fixture.js`: the real UI on canned data, with hash routes per
  view, for screenshot review without an API key.

## Decisions worth recording

- The standalone flow-temperature form is gone; the curve is the control.
- Daily history now requests `DAY` grouping, matching what the view claims to show.
- The controller restart button was dropped: no such mutation exists in the schema.
- No return temperature is drawn, because the API does not return one.
