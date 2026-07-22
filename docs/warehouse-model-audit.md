# Warehouse Model Audit

## Summary

The Warehouse Digital Twin scene now follows the attached schematic as an interactive light-theme 3D/isometric warehouse model. The scene remains code-rendered, not a static image. The dark grid/workspace styling was removed, rack rows are modeled as purposeful 3D cuboids, and the visible scene elements are limited to zones, racks, docks, checkpoints, sensors, staging pallets, the packing bench, walls, lanes, and selected preset routes.

## Element Audit

| Element ID | Element Name | Type | Location | Purpose | Keep / Modify / Remove | Action Taken |
|---|---|---|---|---|---|---|
| FLOOR-BOARD | Light floor-plan board | Floor/base | Whole warehouse canvas | Presentation-ready planning surface | Modify | Replaced dark board with warm off-white board |
| WALL-OUTER | Warehouse outer boundary | Architectural wall line | Perimeter | Defines warehouse shell | Keep | Restyled as thin slate outline |
| WALL-INNER-01..07 | Internal partitions | Architectural wall line | Zone separators | Defines rooms, controlled areas, and process boundaries | Keep | Restyled as thin slate partitions |
| LANE-RECEIVING-CORRIDOR | Receiving corridor lane | Faint static lane | Receiving / Cold Inspection | Shows inbound walkable corridor | Keep | Kept as light blue low-opacity lane |
| LANE-MAIN-STORAGE-AISLE | Main storage aisle | Faint static lane | Storage cross-aisle | Shows validated storage movement corridor | Keep | Kept as light slate low-opacity lane |
| LANE-PACKING | Packing lane | Faint static lane | Pallet Staging / Packing | Shows picking-to-packing corridor | Keep | Kept as light purple low-opacity lane |
| LANE-DISPATCH | Dispatch lane | Faint static lane | Dispatch Staging / docks | Shows dock release corridor | Keep | Kept as light amber low-opacity lane |
| RCV | Receiving | Zone surface and label | Left side | Inbound receipt point | Keep | Restyled as enclosed light-blue receiving room |
| CI | Cold Inspection | Zone surface and label | Left side below Receiving | Quality and temperature check before storage | Keep | Restyled as enclosed light-cyan inspection room |
| CS | Cold Storage | Zone surface and label | Upper-left | 2-8 C cold-chain storage for vaccine/biologic SKUs | Keep | Restyled with light teal fill and temperature band |
| AM | Ambient Storage | Zone surface and label | Lower-left | Ambient storage for non-cold-chain batches | Keep | Restyled with light green fill and temperature band |
| PH | Pharmaceutical Storage | Zone surface and label | Upper-right | Controlled pharmaceutical SKU storage | Keep | Restyled with light orange fill and temperature band |
| QA | QA Hold | Controlled room | Far-right upper room | Short-term hold for QA review | Keep | Restyled as separated controlled room with stronger boundary |
| QT | Quarantine | Controlled room | Far-right middle room | Isolated exception inventory | Keep | Restyled as separated restricted room with stronger boundary |
| PS | Pallet Staging Positions | Zone surface and label | Center-right | Pallets ready for packing/consolidation | Keep | Restyled with light amber fill and pallet positions |
| PK | Packing Bench | Work room/object and label | Center-right beside Pallet Staging | Packing, labelling, and documentation | Keep | Kept as distinct light-purple workbench area |
| DS | Dispatch Staging | Zone surface and label | Lower-middle above docks | Orders staged for outbound loading | Keep | Restyled with light amber fill and temperature band |
| CS-R01 | Cold Storage Rack 01 | 3D rack cuboid | Cold Storage | Rack row for cold-chain SKU drilldown | Modify | Converted to 3D cuboid with lengthwise top label |
| CS-R02 | Cold Storage Rack 02 | 3D rack cuboid | Cold Storage | Rack row for cold-chain SKU drilldown | Modify | Converted to 3D cuboid with lengthwise top label |
| CS-R03 | Cold Storage Rack 03 | 3D rack cuboid | Cold Storage | Rack row for cold-chain SKU drilldown | Modify | Converted to 3D cuboid with lengthwise top label |
| CS-R04 | Cold Storage Rack 04 | 3D rack cuboid | Cold Storage | Rack row for cold-chain SKU drilldown | Modify | Converted to 3D cuboid with lengthwise top label |
| AM-R01 | Ambient Storage Rack 01 | 3D rack cuboid | Ambient Storage | Rack row for ambient SKU drilldown | Modify | Converted to 3D cuboid with lengthwise top label |
| AM-R02 | Ambient Storage Rack 02 | 3D rack cuboid | Ambient Storage | Rack row for ambient SKU drilldown | Modify | Converted to 3D cuboid with lengthwise top label |
| AM-R03 | Ambient Storage Rack 03 | 3D rack cuboid | Ambient Storage | Rack row for ambient SKU drilldown | Modify | Converted to 3D cuboid with lengthwise top label |
| PH-R01 | Pharmaceutical Storage Rack 01 | 3D rack cuboid | Pharmaceutical Storage | Rack row for pharmaceutical SKU drilldown | Modify | Converted to 3D cuboid with lengthwise top label |
| PH-R02 | Pharmaceutical Storage Rack 02 | 3D rack cuboid | Pharmaceutical Storage | Rack row for pharmaceutical SKU drilldown | Modify | Converted to 3D cuboid with lengthwise top label |
| PH-R03 | Pharmaceutical Storage Rack 03 | 3D rack cuboid | Pharmaceutical Storage | Rack row for pharmaceutical SKU drilldown | Modify | Converted to 3D cuboid with lengthwise top label |
| PH-R04 | Pharmaceutical Storage Rack 04 | 3D rack cuboid | Pharmaceutical Storage | Rack row for pharmaceutical SKU drilldown | Modify | Converted to 3D cuboid with lengthwise top label |
| TEMP-CS-01 | Cold Sensor 01 | Temperature sensor marker | Cold Storage | Monitors 2-8 C cold-chain condition | Keep | Kept as small hover-labeled marker |
| TEMP-CS-02 | Cold Sensor 02 | Temperature sensor marker | Cold Storage | Monitors 2-8 C cold-chain condition | Keep | Kept as small hover-labeled marker |
| TEMP-AM-01 | Ambient Sensor 01 | Temperature sensor marker | Ambient Storage | Monitors ambient storage condition | Keep | Kept as small hover-labeled marker |
| TEMP-AM-02 | Ambient Sensor 02 | Temperature sensor marker | Ambient Storage | Monitors ambient storage condition | Keep | Kept as small hover-labeled marker |
| TEMP-PH-01 | Ambient Sensor 03 | Temperature sensor marker | Pharmaceutical Storage | Monitors controlled pharmaceutical storage condition | Keep | Kept as small hover-labeled marker |
| TEMP-PH-02 | Ambient Sensor 04 | Temperature sensor marker | Pharmaceutical Storage | Monitors controlled pharmaceutical storage condition | Keep | Kept as small hover-labeled marker |
| TEMP-DS-01 | Ambient Sensor 05 | Temperature sensor marker | Dispatch Staging | Monitors outbound staging condition | Keep | Kept as small hover-labeled marker |
| RFID-GATE-1 | RFID Gate 1 | RFID checkpoint | Receiving entrance | Confirms inbound goods receipt | Modify | Kept as one of exactly three numbered checkpoints |
| RFID-GATE-2 | RFID Gate 2 | RFID checkpoint | Storage exit corridor | Confirms SKU/pallet left storage for picking/packing | Modify | Kept as one of exactly three numbered checkpoints |
| RFID-GATE-3 | RFID Gate 3 | RFID checkpoint | Before dock release | Confirms final outbound scan | Modify | Kept as one of exactly three numbered checkpoints |
| PS-P01..05 | Pallet staging positions | Pallet objects | Pallet Staging Positions | Represents pallets ready for consolidation | Keep | Kept only in staging area |
| PK-BENCH | Packing Bench work surface | Workbench object | Packing Bench | Represents packing/labelling/documentation work | Keep | Kept as process object, not a rack |
| D1 | Dock door D1 | Dock door/status marker | Bottom dock row | Outbound dispatch assignment point | Keep | Kept with readable label and small status light |
| D2 | Dock door D2 | Dock door/status marker | Bottom dock row | Outbound dispatch assignment point | Keep | Kept with readable label and small status light |
| D3 | Dock door D3 | Dock door/status marker | Bottom dock row | Outbound dispatch assignment point | Keep | Kept with readable label and small status light |
| D4 | Dock door D4 | Dock door/status marker | Bottom dock row | Outbound dispatch assignment point | Keep | Kept with readable label and small status light |
| D5 | Dock door D5 | Dock door/status marker | Bottom dock row | Outbound dispatch assignment point | Keep | Kept with readable label and small status light |
| D6 | Dock door D6 | Dock door/status marker | Bottom dock row | Outbound dispatch assignment point | Keep | Kept with readable label and small status light |
| ROUTE-receiving-to-cold-inspection | Receiving to Cold Inspection | Preset route segment | Receiving corridor | Inbound inspection route | Keep | Preserved as aisle-safe orthogonal segment |
| ROUTE-cold-inspection-to-cold-storage-corridor | Cold Inspection to Cold Storage corridor | Preset route segment | Left corridor to Cold Storage | Moves inspected cold goods to cold corridor | Modify | Renamed/aligned to schematic route terminology |
| ROUTE-receiving-to-ambient-storage | Receiving to Ambient Storage | Preset route segment | Receiving to Ambient Storage | Moves inbound ambient goods to ambient storage | Keep | Preserved as aisle-safe orthogonal segment |
| ROUTE-receiving-to-pharmaceutical-storage | Receiving to Pharmaceutical Storage | Preset route segment | Receiving to Pharmaceutical Storage | Moves inbound pharma goods to pharma storage | Keep | Preserved as aisle-safe orthogonal segment |
| ROUTE-cold-storage-to-storage-exit-rfid | Cold Storage to RFID Gate 2 | Preset route segment | Cold Storage corridor | Confirms cold SKU exits storage | Modify | Split out from old storage-to-packing path |
| ROUTE-ambient-storage-to-storage-exit-rfid | Ambient Storage to RFID Gate 2 | Preset route segment | Ambient Storage corridor | Confirms ambient SKU exits storage | Modify | Split out from old storage-to-packing path |
| ROUTE-pharmaceutical-storage-to-storage-exit-rfid | Pharmaceutical Storage to RFID Gate 2 | Preset route segment | Pharma Storage corridor | Confirms pharma SKU exits storage | Modify | Split out from old storage-to-packing path |
| ROUTE-storage-exit-rfid-to-pallet-staging | RFID Gate 2 to Pallet Staging | Preset route segment | Storage exit corridor | Moves picked SKU/pallet toward staging | Keep | Added explicit schematic segment |
| ROUTE-pallet-staging-to-packing-bench | Pallet Staging to Packing Bench | Preset route segment | Center-right staging lane | Moves staged pallets to packing | Keep | Added explicit schematic segment |
| ROUTE-packing-bench-to-dispatch-staging | Packing Bench to Dispatch Staging | Preset route segment | Packing to dispatch lane | Moves packed goods to dispatch staging | Modify | Renamed from broad packing-to-dispatch segment |
| ROUTE-dispatch-staging-to-rfid-gate-3 | Dispatch Staging to RFID Gate 3 | Preset route segment | Dispatch lane | Final outbound scan before dock | Keep | Added explicit schematic segment |
| ROUTE-rfid-gate-3-to-d1 | RFID Gate 3 to D1 | Preset route segment | Dock lane | Dock release to D1 | Modify | Renamed from dispatch-staging-to-d1 |
| ROUTE-rfid-gate-3-to-d2 | RFID Gate 3 to D2 | Preset route segment | Dock lane | Dock release to D2 | Modify | Renamed from dispatch-staging-to-d2 |
| ROUTE-rfid-gate-3-to-d3 | RFID Gate 3 to D3 | Preset route segment | Dock lane | Dock release to D3 | Modify | Renamed from dispatch-staging-to-d3 |
| ROUTE-rfid-gate-3-to-d4 | RFID Gate 3 to D4 | Preset route segment | Dock lane | Dock release to D4 | Modify | Renamed from dispatch-staging-to-d4 |
| ROUTE-rfid-gate-3-to-d5 | RFID Gate 3 to D5 | Preset route segment | Dock lane | Dock release to D5 | Modify | Renamed from dispatch-staging-to-d5 |
| ROUTE-rfid-gate-3-to-d6 | RFID Gate 3 to D6 | Preset route segment | Dock lane | Dock release to D6 | Modify | Renamed from dispatch-staging-to-d6 |
| ROUTE-pharmaceutical-storage-to-qa-hold | Pharmaceutical Storage to QA Hold | Preset exception segment | Pharma Storage to QA Hold | Quality hold review path | Keep | Preserved as warning/blocked capable segment |
| ROUTE-qa-hold-to-quarantine | QA Hold to Quarantine | Preset exception segment | Controlled rooms | Quarantine exception path | Keep | Preserved as warning/blocked capable segment |
| ROUTE-rack-access-CS-R01..PH-R04 | Rack access segments | Preset rack segments | Storage aisles to each rack | Routes selection to rack aisle without crossing racks | Keep | Generated for all rack rows |
| CI-TEMP-01 | Cold Inspection sensor | Temperature sensor | Cold Inspection | No final operational monitoring requirement | Remove | Removed from layout data |
| DOCK-SHIPMENT-BOXES | Dock-side shipment boxes | Box props | Dock row | Duplicated dock status and cluttered scene | Remove | Removed from dock renderer |
| RACK-TOP-BOXES | Cartons on rack blocks | Box props | Rack tops | Mixed rack abstraction styles | Remove | Not rendered; racks are cuboids only |
| DARK-GRID-BOARD | Dark grid workspace | Background style | Warehouse canvas | Conflicted with schematic reference | Remove | Replaced with light planning board |
| EXTRA-RFID-GATES | Extra RFID markers | RFID props | Various | No clear checkpoint purpose | Remove | Not rendered; exactly three RFID gates remain |

## Workflow Justification

- Sector selection highlights the selected zone and drives the rack list in the inspector.
- Rack selection highlights the rack cuboid and opens bin/SKU context.
- SKU selection keeps global inventory state synchronized and shows FEFO, cold-chain, quality, shipment, and route context.
- RFID gates are only shown where movement scans are operationally meaningful.
- Sensors are only shown in monitored storage/dispatch areas.
- Routes are preset, orthogonal, sparse, and only shown for selected sector/rack/SKU/stage context.
