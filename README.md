# SlotWise

Plan a clash-free semester timetable from the institute's pre-registration course schedule.

## Run locally

```bash
./run.sh            # builds data from the .xlsx, serves at http://localhost:8765 and opens it
PORT=9000 ./run.sh  # use another port
OPEN=0 ./run.sh     # don't open a browser
```

Needs only `python3` (standard library). `run.sh` picks the newest `.xlsx` in this folder and rebuilds
`web/data/courses.json` whenever the spreadsheet is newer than the JSON, so to update the catalogue just drop
in the new schedule file and restart.

## Features

- **Enter courses taken**: pick branch, then course; the hint shows times, credits, prerequisites and any clash before you add.
- **Total Credits** bar with removable course chips; clashing courses turn red.
- **Weekly Timetable** (Mon–Fri, 08:00–20:00): lectures, tutorials and labs placed by time, overlapping sessions shown side by side in red. Click a block or chip for details or to remove it.
- **Check Available Courses**: filter by search, branch, course type and half-semester; by default only shows courses that fit around your current plan.
- **Topic Base Recommendation**: type a topic (or pick one) to get related courses ranked by relevance, with fit/clash status.
- **Menu (☰)**: print / save as PDF, copy course list, copy share link (`#courses=CE432,CS661`), export / import a plan.
- First-half and second-half courses are treated as non-clashing with each other.
- Your plan is saved in the browser automatically.

## Layout

```
run.sh                  build + serve
scripts/build_data.py   .xlsx -> web/data/courses.json (stdlib only)
web/index.html          page
web/style.css
web/app.js              UI
web/scheduler.js        clash detection, layout, recommendations (pure, tested)
tests/                  node --test tests/*.test.mjs
```

## Tests

```bash
npm test     # or: node --test tests/*.test.mjs
```
