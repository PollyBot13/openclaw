"""Combine explicitly independent native action cases; retain all original receipts."""
import json
import sys
from pathlib import Path

output = Path(sys.argv[1])
phase = sys.argv[2]
modes = ["captures", "thinkingLevel-off", "thinkingLevel-high", "verboseLevel-off", "verboseLevel-on"]
observations, requests, patches, cases = [], [], [], []
control = {"thinkingLevel": "high", "verboseLevel": "on"}
previous = {}
for mode in modes:
    receipt = json.loads((output / f"{phase}-{mode}-receipts.json").read_text())
    wire = json.loads((output / f"{phase}-{mode}-wire-progress.json").read_text())
    assert receipt["phase"] == phase and receipt["mode"] == mode
    assert wire["stored"]["proof-control-B"] == control
    if mode == "captures":
        assert len(receipt["observations"]) == 10 and not wire["patches"]
    else:
        field, value = mode.split("-")
        assert len(receipt["observations"]) == 1
        action = receipt["observations"][0]
        expected_patch = {"key": "proof-target-A", field: value}
        assert action["selection"] == f"{phase}-click-{mode}"
        assert action["initialA"] == previous and action["caseIsolation"] == "fresh native process"
        assert action["request"] == expected_patch and wire["patches"] == [expected_patch]
        previous[field] = value
        assert action["storedA"] == previous and action["storedB"] == control
        assert wire["stored"]["proof-target-A"] == previous
        assert action["checkedAfterReadback"] == [value]
    observations.extend(receipt["observations"])
    requests.extend(receipt["requests"])
    patches.extend(wire["patches"])
    cases.append({"mode": mode, "receipt": f"{phase}-{mode}-receipts.json", "wire": f"{phase}-{mode}-wire-progress.json"})
(output / f"{phase}-receipts.json").write_text(json.dumps({"phase": phase, "isolation": "independent native processes, seeded sequence predecessors", "cases": cases, "observations": observations, "requests": requests}, indent=2, sort_keys=True))
(output / f"{phase}-wire-progress.json").write_text(json.dumps({"isolation": "aggregate of independent cases; raw wire files retained", "cases": cases, "requests": requests, "patches": patches, "stored": wire["stored"], "agentDefaults": wire["agentDefaults"]}, indent=2, sort_keys=True))
