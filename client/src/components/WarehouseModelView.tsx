import { useMemo, useRef, useState } from "react";
import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import { ContactShadows, Line, OrbitControls, Text } from "@react-three/drei";
import * as THREE from "three";
import type { Mesh } from "three";
import type { Dock } from "@twinops/shared";
import { useAppStore } from "../store";
import {
  buildInternalRoute,
  buildWarehouseBins,
  dockLayout,
  getRack,
  getRackForPlacement,
  getSector,
  isExpiryRisk,
  resolveDockIdForPlacement,
  rfidCheckpoints,
  warehouseRacks,
  warehouseSectors,
  type Bounds,
  type InternalRoute,
  type RfidCheckpoint,
  type RouteState,
  type Vec2,
  type WarehouseBin,
  type WarehouseRack,
  type WarehouseSector
} from "../warehouseLayout";

type WarehouseMode = "Overview" | "FEFO" | "Cold Chain" | "Dock Flow" | "QA Hold";
type SceneClickEvent = ThreeEvent<MouseEvent>;
type PopupType = "zone" | "rack" | "sku" | "dock" | "rfid" | "sensor";
type PopupView = "summary" | "racks" | "skus" | "scans" | "telemetry";

export type WarehouseModelPopup = {
  type: PopupType;
  id: string;
  view?: PopupView;
  sectorId?: string;
  sensorLabel?: string;
};

type DoorGap = {
  side: "north" | "south" | "east" | "west";
  center: number;
  size: number;
};

const emptyDocks: Dock[] = [];
const wallMaterial = "#cbd5e1";
const wallTop = "#f8fafc";
const modelInk = "#1e293b";
const mutedInk = "#64748b";
const routeColors: Record<RouteState, string> = {
  normal: "#67e8f9",
  warning: "#f5c451",
  blocked: "#ff706c",
  selected: "#67e8f9"
};

const floorColors: Record<WarehouseSector["type"], string> = {
  receiving: "#dce8f4",
  inspection: "#dff3fb",
  cold: "#d6eef8",
  ambient: "#dcefe2",
  pharma: "#f3dfc8",
  qa: "#f6e7b8",
  quarantine: "#f0c5c5",
  staging: "#f3ead0",
  packing: "#e7def6",
  dispatch: "#e1e5ea"
};

const rackToneByZone: Record<"CS" | "AM" | "PH", { rail: string; beam: string; deck: string; label: string }> = {
  CS: { rail: "#1f6fa5", beam: "#4ea3d2", deck: "#c8e7f5", label: "#075985" },
  AM: { rail: "#2c7a4f", beam: "#68a87f", deck: "#d6eddc", label: "#14532d" },
  PH: { rail: "#a86422", beam: "#d19a51", deck: "#f0ddbf", label: "#7c3e08" }
};

const zoneLabelConfig: Partial<Record<WarehouseSector["id"], { x: number; z: number; width: number; fontSize: number; subLabel?: string }>> = {
  RCV: { x: -5.16, z: 1.0, width: 0.78, fontSize: 0.074 },
  CI: { x: -5.16, z: 2.18, width: 0.86, fontSize: 0.065 },
  CS: { x: -2.88, z: -0.44, width: 1.58, fontSize: 0.108, subLabel: "C01-C04" },
  AM: { x: -3.08, z: 0.34, width: 1.62, fontSize: 0.102, subLabel: "A01-A03" },
  PH: { x: 1.5, z: -0.44, width: 2.0, fontSize: 0.102, subLabel: "P01-P04" },
  QA: { x: 4.46, z: -2.5, width: 0.76, fontSize: 0.072 },
  QT: { x: 4.46, z: -1.25, width: 0.94, fontSize: 0.066 },
  PS: { x: 1.18, z: 1.02, width: 1.9, fontSize: 0.074 },
  PK: { x: 3.98, z: 0.88, width: 1.12, fontSize: 0.076 },
  DS: { x: 1.54, z: 1.62, width: 1.42, fontSize: 0.078 }
};

const roomDoorGaps: Partial<Record<string, DoorGap[]>> = {
  RCV: [{ side: "east", center: 1.18, size: 0.44 }],
  CI: [{ side: "east", center: 2.18, size: 0.44 }],
  CS: [
    { side: "south", center: -4.15, size: 0.62 },
    { side: "east", center: -1.12, size: 0.56 }
  ],
  AM: [
    { side: "north", center: -4.15, size: 0.62 },
    { side: "east", center: 1.26, size: 0.58 }
  ],
  PH: [
    { side: "south", center: -0.35, size: 0.68 },
    { side: "east", center: -2.48, size: 0.5 }
  ],
  QA: [{ side: "west", center: -2.52, size: 0.46 }],
  QT: [{ side: "west", center: -1.25, size: 0.46 }],
  PS: [
    { side: "west", center: 0.62, size: 0.55 },
    { side: "east", center: 0.62, size: 0.55 }
  ],
  PK: [{ side: "west", center: 0.62, size: 0.5 }],
  DS: [
    { side: "north", center: 1.55, size: 0.65 },
    { side: "south", center: 1.55, size: 1.2 }
  ]
};

function toPoint(point: Vec2, y = 0.11): [number, number, number] {
  return [point.x, y, point.z];
}

function centerOf(bounds: Bounds): [number, number, number] {
  return [bounds.x + bounds.width / 2, 0, bounds.z + bounds.depth / 2];
}

function compactRackLabel(rack: WarehouseRack) {
  const parsed = rack.id.match(/R(\d+)/i)?.[1] ?? "";
  const prefix = rack.zoneId === "CS" ? "C" : rack.zoneId === "AM" ? "A" : "P";
  return `${prefix}${parsed.padStart(2, "0")}`;
}

function rectPoints(x: number, z: number, width: number, depth: number, y = 0.055): Array<[number, number, number]> {
  return [
    [x, y, z],
    [x + width, y, z],
    [x + width, y, z + depth],
    [x, y, z + depth],
    [x, y, z]
  ];
}

function createConcreteTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.CanvasTexture(canvas);

  context.fillStyle = "#e8eef3";
  context.fillRect(0, 0, canvas.width, canvas.height);

  for (let index = 0; index < 5200; index += 1) {
    const x = (index * 47) % canvas.width;
    const y = (index * 83) % canvas.height;
    const alpha = 0.018 + ((index * 13) % 19) / 1200;
    context.fillStyle = `rgba(67, 85, 104, ${alpha})`;
    context.fillRect(x, y, 1, 1);
  }

  context.strokeStyle = "rgba(255, 255, 255, 0.22)";
  context.lineWidth = 1;
  for (let pos = 0; pos <= canvas.width; pos += 64) {
    context.beginPath();
    context.moveTo(pos + 0.5, 0);
    context.lineTo(pos + 0.5, canvas.height);
    context.stroke();
    context.beginPath();
    context.moveTo(0, pos + 0.5);
    context.lineTo(canvas.width, pos + 0.5);
    context.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(5.8, 3.8);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createRadialGlowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.CanvasTexture(canvas);
  const gradient = context.createRadialGradient(256, 250, 28, 256, 250, 250);
  gradient.addColorStop(0, "rgba(255, 255, 255, 0.8)");
  gradient.addColorStop(0.42, "rgba(207, 230, 240, 0.28)");
  gradient.addColorStop(1, "rgba(207, 230, 240, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function WarehouseFloorEnvironment() {
  const concreteTexture = useMemo(createConcreteTexture, []);
  const glowTexture = useMemo(createRadialGlowTexture, []);
  const y = -0.075;
  const expansionJoints = [
    ...[-7.2, -3.6, 0, 3.6, 7.2].map((x) => ({
      id: `joint-x-${x}`,
      points: [[x, y, -5.1], [x, y, 5.1]] as Array<[number, number, number]>
    })),
    ...[-4.0, -2.0, 0, 2.0, 4.0].map((z) => ({
      id: `joint-z-${z}`,
      points: [[-8.6, y, z], [8.6, y, z]] as Array<[number, number, number]>
    }))
  ];
  const blueprintRects = [
    { id: "left-traffic-lane", points: rectPoints(-7.05, -2.95, 0.82, 5.9, y + 0.004), opacity: 0.22 },
    { id: "right-traffic-lane", points: rectPoints(6.12, -2.65, 0.78, 5.0, y + 0.004), opacity: 0.18 },
    { id: "dock-apron-outer", points: rectPoints(-1.05, 3.34, 5.7, 0.96, y + 0.006), opacity: 0.28 },
    { id: "warehouse-clearance", points: rectPoints(-5.88, -3.42, 11.3, 6.9, y + 0.005), opacity: 0.26 }
  ];
  const dockGuideLines = dockLayout.map((dock) => ({
    id: `apron-${dock.id}`,
    points: rectPoints(dock.position.x - 0.34, 3.38, 0.68, 0.74, y + 0.008)
  }));

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.1, 0.18]} receiveShadow>
        <planeGeometry args={[18.5, 11.2]} />
        <meshStandardMaterial color="#edf3f7" map={concreteTexture} roughness={0.98} metalness={0} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0.05, -0.092, 0.12]}>
        <planeGeometry args={[15.4, 9.2]} />
        <meshBasicMaterial map={glowTexture} transparent opacity={0.78} depthWrite={false} />
      </mesh>
      {expansionJoints.map((line) => (
        <Line key={line.id} points={line.points} color="#94a3b8" lineWidth={0.45} transparent opacity={0.13} />
      ))}
      {blueprintRects.map((rect) => (
        <Line key={rect.id} points={rect.points} color="#b6c7d5" lineWidth={0.8} transparent opacity={rect.opacity} />
      ))}
      {dockGuideLines.map((line) => (
        <Line key={line.id} points={line.points} color="#d6a742" lineWidth={0.85} transparent opacity={0.2} />
      ))}
    </group>
  );
}

function splitWall(start: number, end: number, gap?: { center: number; size: number }) {
  if (!gap) return [{ start, end }];
  const half = gap.size / 2;
  const firstEnd = Math.max(start, gap.center - half);
  const secondStart = Math.min(end, gap.center + half);
  return [
    { start, end: firstEnd },
    { start: secondStart, end }
  ].filter((part) => part.end - part.start > 0.08);
}

function RoomWall({ bounds, gap, side, height }: { bounds: Bounds; gap?: DoorGap; side: DoorGap["side"]; height: number }) {
  const thickness = 0.075;
  const y = height / 2 + 0.025;
  const isHorizontal = side === "north" || side === "south";
  const axisStart = isHorizontal ? bounds.x : bounds.z;
  const axisEnd = isHorizontal ? bounds.x + bounds.width : bounds.z + bounds.depth;
  const fixed = side === "north" ? bounds.z : side === "south" ? bounds.z + bounds.depth : side === "west" ? bounds.x : bounds.x + bounds.width;
  const parts = splitWall(axisStart, axisEnd, gap ? { center: gap.center, size: gap.size } : undefined);
  return (
    <>
      {parts.map((part) => {
        const length = part.end - part.start;
        const mid = part.start + length / 2;
        const position: [number, number, number] = isHorizontal ? [mid, y, fixed] : [fixed, y, mid];
        const args: [number, number, number] = isHorizontal ? [length, height, thickness] : [thickness, height, length];
        return (
          <group key={`${side}-${part.start}-${part.end}`}>
            <mesh position={position} castShadow receiveShadow>
              <boxGeometry args={args} />
              <meshStandardMaterial color={wallMaterial} roughness={0.62} />
            </mesh>
            <mesh position={[position[0], height + 0.055, position[2]]}>
              <boxGeometry args={isHorizontal ? [length, 0.035, thickness + 0.02] : [thickness + 0.02, 0.035, length]} />
              <meshStandardMaterial color={wallTop} roughness={0.46} />
            </mesh>
          </group>
        );
      })}
    </>
  );
}

function RoomModel({
  sector,
  active,
  dimmed,
  onClick
}: {
  sector: WarehouseSector;
  active: boolean;
  dimmed: boolean;
  onClick: (event: SceneClickEvent) => void;
}) {
  const pulseRef = useRef<Mesh>(null);
  const [hovered, setHovered] = useState(false);
  useFrame(({ clock }) => {
    if (!pulseRef.current) return;
    pulseRef.current.position.y = active ? 0.022 + Math.sin(clock.elapsedTime * 4) * 0.006 : 0.018;
  });
  const [x, , z] = centerOf(sector.bounds);
  const wallHeight = sector.type === "qa" || sector.type === "quarantine" ? 0.56 : sector.type === "staging" || sector.type === "dispatch" ? 0.2 : 0.42;
  const doorGaps = roomDoorGaps[sector.id] ?? [];
  const roomColor = floorColors[sector.type];
  const label = zoneLabelConfig[sector.id] ?? {
    x,
    z: sector.bounds.z + Math.min(sector.bounds.depth - 0.18, 0.28),
    width: Math.min(1.4, Math.max(0.72, sector.name.length * 0.06)),
    fontSize: sector.bounds.width < 1.1 ? 0.058 : 0.075
  };
  const labelActive = active || hovered;
  return (
    <group
      onClick={(event) => {
        event.stopPropagation();
        onClick(event);
      }}
      onPointerOver={(event) => {
        event.stopPropagation();
        setHovered(true);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        setHovered(false);
        document.body.style.cursor = "";
      }}
    >
      <mesh position={[x, 0, z]} receiveShadow>
        <boxGeometry args={[sector.bounds.width, 0.055, sector.bounds.depth]} />
        <meshStandardMaterial color={roomColor} roughness={0.82} metalness={0.01} />
      </mesh>
      <Line
        points={rectPoints(sector.bounds.x, sector.bounds.z, sector.bounds.width, sector.bounds.depth, 0.066)}
        color={active ? "#0e7490" : mutedInk}
        lineWidth={labelActive ? 2.1 : 0.72}
        transparent
        opacity={active ? 0.9 : hovered ? 0.64 : dimmed ? 0.18 : 0.34}
      />
      <mesh ref={pulseRef} position={[x, 0.018, z]} receiveShadow>
        <boxGeometry args={[sector.bounds.width - 0.12, 0.014, sector.bounds.depth - 0.12]} />
        <meshStandardMaterial color={active ? "#67e8f9" : "#ffffff"} roughness={0.7} transparent opacity={active ? 0.28 : dimmed ? 0.08 : 0.16} />
      </mesh>
      {(["north", "south", "east", "west"] as const).map((side) => (
        <RoomWall key={`${sector.id}-${side}`} bounds={sector.bounds} side={side} height={wallHeight} gap={doorGaps.find((gap) => gap.side === side)} />
      ))}
      <mesh position={[label.x, 0.118, label.z]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[label.width, label.subLabel ? 0.28 : 0.2]} />
        <meshBasicMaterial color={labelActive ? "#ffffff" : "#f8fafc"} transparent opacity={labelActive ? 0.9 : 0.76} depthWrite={false} />
      </mesh>
      <Text
        position={[label.x, 0.134, label.subLabel ? label.z - 0.04 : label.z]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={label.fontSize}
        color={labelActive ? "#075985" : modelInk}
        anchorX="center"
        anchorY="middle"
      >
        {sector.name.toUpperCase()}
      </Text>
      {label.subLabel && (
        <Text position={[label.x, 0.137, label.z + 0.105]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.064} color={mutedInk} anchorX="center" anchorY="middle">
          {label.subLabel}
        </Text>
      )}
    </group>
  );
}

function RackModel({
  rack,
  active,
  muted,
  onClick
}: {
  rack: WarehouseRack;
  active: boolean;
  muted: boolean;
  onClick: (event: SceneClickEvent) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const tone = rack.zoneId === "CS" || rack.zoneId === "AM" || rack.zoneId === "PH" ? rackToneByZone[rack.zoneId] : rackToneByZone.PH;
  const frameColor = active ? "#075985" : tone.rail;
  const height = 0.72;
  const shelfLevels = [0.18, 0.36, 0.54];
  const postZ = [-rack.size.depth / 2 - 0.06, 0, rack.size.depth / 2 + 0.06];
  const sideX = [-rack.size.width / 2 - 0.055, rack.size.width / 2 + 0.055];
  const rackOpacity = muted ? 0.42 : 0.92;
  return (
    <group
      position={[rack.center.x, 0.045, rack.center.z]}
      onClick={(event) => {
        event.stopPropagation();
        onClick(event);
      }}
      onPointerOver={(event) => {
        event.stopPropagation();
        setHovered(true);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        setHovered(false);
        document.body.style.cursor = "";
      }}
    >
      <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[rack.size.width + 0.36, rack.size.depth + 0.28]} />
        <meshBasicMaterial color="#334155" transparent opacity={muted ? 0.035 : 0.075} depthWrite={false} />
      </mesh>
      {sideX.flatMap((x) =>
        postZ.map((z) => (
          <mesh key={`post-${x}-${z}`} position={[x, height / 2, z]} castShadow>
            <boxGeometry args={[0.045, height, 0.045]} />
            <meshStandardMaterial color={frameColor} roughness={0.48} transparent opacity={rackOpacity} />
          </mesh>
        ))
      )}
      {shelfLevels.map((level) => (
        <group key={level}>
          <mesh position={[0, level, 0]} castShadow receiveShadow>
            <boxGeometry args={[rack.size.width + 0.08, 0.024, rack.size.depth + 0.08]} />
            <meshStandardMaterial color={tone.deck} roughness={0.62} transparent opacity={muted ? 0.26 : 0.52} />
          </mesh>
          {sideX.map((x) => (
            <mesh key={`side-rail-${level}-${x}`} position={[x, level + 0.02, 0]} castShadow>
              <boxGeometry args={[0.052, 0.045, rack.size.depth + 0.18]} />
              <meshStandardMaterial color={tone.beam} roughness={0.5} transparent opacity={rackOpacity} />
            </mesh>
          ))}
          {postZ.map((z) => (
            <mesh key={`cross-rail-${level}-${z}`} position={[0, level + 0.018, z]} castShadow>
              <boxGeometry args={[rack.size.width + 0.18, 0.036, 0.04]} />
              <meshStandardMaterial color={tone.beam} roughness={0.5} transparent opacity={rackOpacity} />
            </mesh>
          ))}
        </group>
      ))}
      <mesh position={[0, 0.07, 0]} castShadow>
        <boxGeometry args={[rack.size.width + 0.16, 0.04, rack.size.depth + 0.14]} />
        <meshStandardMaterial color={active ? "#dff8ff" : "#f8fafc"} roughness={0.68} transparent opacity={muted ? 0.3 : 0.74} />
      </mesh>
      <Line
        points={[
          [-rack.size.width / 2 - 0.13, height + 0.04, -rack.size.depth / 2 - 0.13],
          [rack.size.width / 2 + 0.13, height + 0.04, -rack.size.depth / 2 - 0.13],
          [rack.size.width / 2 + 0.13, height + 0.04, rack.size.depth / 2 + 0.13],
          [-rack.size.width / 2 - 0.13, height + 0.04, rack.size.depth / 2 + 0.13],
          [-rack.size.width / 2 - 0.13, height + 0.04, -rack.size.depth / 2 - 0.13]
        ]}
        color={active ? "#0891b2" : hovered ? "#0f766e" : "#475569"}
        lineWidth={active ? 2.4 : hovered ? 1.55 : 1.05}
        transparent
        opacity={active ? 0.95 : hovered ? 0.72 : muted ? 0.28 : 0.56}
      />
      <Text position={[0, height + 0.08, 0]} rotation={[-Math.PI / 2, 0, Math.PI / 2]} fontSize={0.098} color={active ? "#075985" : tone.label} anchorX="center" anchorY="middle">
        {compactRackLabel(rack)}
      </Text>
    </group>
  );
}

function PalletStack({ position, tone = "neutral" }: { position: Vec2; tone?: "neutral" | "warning" | "cold" }) {
  const cargoColor = tone === "warning" ? "#fca5a5" : tone === "cold" ? "#bfdbfe" : "#f1dfb8";
  return (
    <group position={[position.x, 0.06, position.z]}>
      <Line points={rectPoints(-0.23, -0.2, 0.46, 0.4, 0.012)} color="#d6a742" lineWidth={0.7} transparent opacity={0.42} />
      <mesh position={[0, 0.06, 0]} castShadow>
        <boxGeometry args={[0.36, 0.07, 0.28]} />
        <meshStandardMaterial color="#a16207" roughness={0.78} />
      </mesh>
      <mesh position={[0, 0.2, 0]} castShadow>
        <boxGeometry args={[0.3, 0.18, 0.22]} />
        <meshStandardMaterial color={cargoColor} roughness={0.68} />
      </mesh>
    </group>
  );
}

function ReceivingInspectionDetails() {
  return (
    <group>
      <Line points={rectPoints(-5.48, 0.78, 0.62, 0.78, 0.082)} color="#93a4b4" lineWidth={0.9} transparent opacity={0.42} />
      <mesh position={[-5.15, 0.08, 1.34]} castShadow receiveShadow>
        <boxGeometry args={[0.48, 0.08, 0.22]} />
        <meshStandardMaterial color="#cbd5e1" roughness={0.78} />
      </mesh>
      <mesh position={[-5.04, 0.18, 1.12]} castShadow>
        <boxGeometry args={[0.26, 0.2, 0.18]} />
        <meshStandardMaterial color="#475569" roughness={0.64} />
      </mesh>
      <mesh position={[-5.22, 0.09, 1.0]} castShadow>
        <boxGeometry args={[0.25, 0.035, 0.04]} />
        <meshStandardMaterial color="#1f2937" roughness={0.62} />
      </mesh>

      <mesh position={[-5.16, 0.17, 2.28]} castShadow receiveShadow>
        <boxGeometry args={[0.46, 0.12, 0.28]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.62} />
      </mesh>
      {[-0.16, 0.16].flatMap((x) =>
        [-0.1, 0.1].map((z) => (
          <mesh key={`inspection-leg-${x}-${z}`} position={[-5.16 + x, 0.08, 2.28 + z]}>
            <boxGeometry args={[0.03, 0.16, 0.03]} />
            <meshStandardMaterial color="#64748b" roughness={0.54} />
          </mesh>
        ))
      )}
      <mesh position={[-5.04, 0.27, 2.24]} castShadow>
        <boxGeometry args={[0.12, 0.07, 0.08]} />
        <meshStandardMaterial color="#bae6fd" roughness={0.48} />
      </mesh>
      <mesh position={[-5.25, 0.26, 2.34]} castShadow>
        <boxGeometry args={[0.09, 0.06, 0.07]} />
        <meshStandardMaterial color="#e2e8f0" roughness={0.58} />
      </mesh>
    </group>
  );
}

function ControlledRoomDetails() {
  return (
    <group>
      <mesh position={[4.48, 0.16, -2.32]} castShadow receiveShadow>
        <boxGeometry args={[0.42, 0.11, 0.22]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.62} />
      </mesh>
      <mesh position={[4.27, 0.25, -2.95]} castShadow>
        <boxGeometry args={[0.28, 0.12, 0.04]} />
        <meshStandardMaterial color="#f6e7b8" roughness={0.54} />
      </mesh>
      <mesh position={[4.48, 0.11, -1.83]} castShadow receiveShadow>
        <boxGeometry args={[0.42, 0.2, 0.06]} />
        <meshStandardMaterial color="#d4dde7" roughness={0.64} />
      </mesh>
      <mesh position={[4.5, 0.18, -1.22]} castShadow>
        <cylinderGeometry args={[0.045, 0.045, 0.24, 14]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.55} />
      </mesh>
      <mesh position={[4.5, 0.32, -1.22]}>
        <sphereGeometry args={[0.052, 12, 8]} />
        <meshStandardMaterial color="#f87171" emissive="#ef4444" emissiveIntensity={0.32} />
      </mesh>
    </group>
  );
}

function WorkflowFloorMarkings() {
  const dashedSegments = [
    [[-5.18, 0.089, 0.52], [-5.18, 0.089, 0.94]],
    [[-5.18, 0.089, 1.2], [-5.18, 0.089, 1.62]],
    [[-5.18, 0.089, 1.88], [-5.18, 0.089, 2.3]],
    [[-4.9, 0.089, 2.42], [-4.48, 0.089, 2.42]],
    [[-4.22, 0.089, 2.18], [-4.22, 0.089, 1.72]],
    [[-4.22, 0.089, 1.46], [-4.22, 0.089, 1.0]],
    [[-4.22, 0.089, 0.74], [-4.22, 0.089, 0.34]],
    [[-0.64, 0.089, 1.2], [0.04, 0.089, 1.2]],
    [[0.32, 0.089, 1.2], [1.0, 0.089, 1.2]],
    [[1.28, 0.089, 1.2], [1.96, 0.089, 1.2]],
    [[2.24, 0.089, 1.2], [2.92, 0.089, 1.2]],
    [[3.04, 0.089, 1.42], [3.04, 0.089, 1.78]],
    [[1.55, 0.089, 1.86], [1.55, 0.089, 2.34]],
    [[1.08, 0.089, 2.58], [0.42, 0.089, 2.58]],
    [[2.02, 0.089, 2.58], [2.68, 0.089, 2.58]]
  ] as Array<[[number, number, number], [number, number, number]]>;
  const chevrons = [
    { x: -5.18, z: 1.78, angle: 0 },
    { x: -4.22, z: 0.88, angle: Math.PI },
    { x: 0.22, z: 1.2, angle: Math.PI / 2 },
    { x: 2.74, z: 1.2, angle: Math.PI / 2 },
    { x: 1.55, z: 2.28, angle: 0 },
    { x: 0.36, z: 2.58, angle: -Math.PI / 2 }
  ];
  return (
    <group>
      {dashedSegments.map((points, index) => (
        <Line key={`workflow-dash-${index}`} points={points} color="#ffffff" lineWidth={1.2} transparent opacity={0.36} />
      ))}
      {chevrons.map((marker) => (
        <group key={`workflow-chevron-${marker.x}-${marker.z}`} position={[marker.x, 0.093, marker.z]} rotation={[0, marker.angle, 0]}>
          <Line points={[[-0.09, 0, -0.07], [0, 0, 0], [0.09, 0, -0.07]]} color="#ffffff" lineWidth={1.1} transparent opacity={0.42} />
        </group>
      ))}
    </group>
  );
}

function PurposefulPallets() {
  const receiving = [{ x: -5.16, z: 1.18 }];
  const staging = [-0.14, 0.58, 1.3, 2.02, 2.74].map((x) => ({ x, z: 0.62 }));
  const dispatch = [-0.2, 0.52, 1.24, 1.96, 2.68, 3.4].map((x) => ({ x, z: 1.74 }));
  const quarantine = [{ x: 4.45, z: -1.3 }];
  return (
    <group>
      {receiving.map((position, index) => <PalletStack key={`receiving-${index}`} position={position} tone="cold" />)}
      {staging.map((position, index) => <PalletStack key={`staging-${index}`} position={position} />)}
      {dispatch.map((position, index) => <PalletStack key={`dispatch-${index}`} position={position} />)}
      {quarantine.map((position, index) => <PalletStack key={`quarantine-${index}`} position={position} tone="warning" />)}
    </group>
  );
}

function PackingBench({ onSelect }: { onSelect: (event: SceneClickEvent) => void }) {
  return (
    <group
      position={[3.98, 0.08, 0.62]}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(event);
      }}
    >
      <mesh position={[0, 0.22, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.0, 0.12, 0.34]} />
        <meshStandardMaterial color="#c4b5fd" roughness={0.58} />
      </mesh>
      {[-0.4, 0.4].flatMap((x) => [-0.12, 0.12].map((z) => (
        <mesh key={`${x}-${z}`} position={[x, 0.09, z]}>
          <boxGeometry args={[0.045, 0.18, 0.045]} />
          <meshStandardMaterial color="#6d28d9" roughness={0.55} />
        </mesh>
      )))}
      <mesh position={[0, 0.34, -0.1]} castShadow>
        <boxGeometry args={[0.82, 0.1, 0.1]} />
        <meshStandardMaterial color="#ede9fe" roughness={0.52} />
      </mesh>
      <Text position={[0, 0.43, -0.31]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.07} color="#3b0764" anchorX="center">
        PACKING BENCH
      </Text>
    </group>
  );
}

function DockDoorModel({
  dockId,
  active,
  status,
  highlighted,
  onClick
}: {
  dockId: string;
  active: boolean;
  status?: Dock["status"];
  highlighted: boolean;
  onClick: (event: SceneClickEvent) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const dock = dockLayout.find((item) => item.id === dockId)!;
  const lightColor = highlighted ? "#ff706c" : status === "available" ? "#5bcf82" : "#f5c451";
  const outlineColor = active ? "#0891b2" : hovered ? "#0f766e" : "#c99a2e";
  return (
    <group
      position={[dock.position.x, 0.04, dock.position.z]}
      onClick={(event) => {
        event.stopPropagation();
        onClick(event);
      }}
      onPointerOver={(event) => {
        event.stopPropagation();
        setHovered(true);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        setHovered(false);
        document.body.style.cursor = "";
      }}
    >
      <mesh position={[0, 0.012, 0.34]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.72, 0.94]} />
        <meshBasicMaterial color={active ? "#dff8ff" : "#f8fafc"} transparent opacity={active ? 0.24 : 0.14} depthWrite={false} />
      </mesh>
      <Line points={rectPoints(-0.36, -0.32, 0.72, 1.02, 0.058)} color={outlineColor} lineWidth={active ? 2 : hovered ? 1.45 : 1.05} transparent opacity={active ? 0.88 : hovered ? 0.72 : 0.52} />
      {[-0.24, 0.24].map((x) => (
        <Line key={`lane-${x}`} points={[[x, 0.061, 0.12], [x, 0.061, 0.66]]} color="#d6a742" lineWidth={0.9} transparent opacity={0.58} />
      ))}
      <mesh position={[0, 0.28, -0.18]} castShadow receiveShadow>
        <boxGeometry args={[0.68, 0.55, 0.13]} />
        <meshStandardMaterial color={active ? "#dff8ff" : "#d5dee8"} roughness={0.72} emissive={active ? "#0891b2" : "#000000"} emissiveIntensity={active ? 0.12 : 0} />
      </mesh>
      <mesh position={[0, 0.3, -0.265]} castShadow>
        <boxGeometry args={[0.48, 0.39, 0.036]} />
        <meshStandardMaterial color="#334155" roughness={0.58} />
      </mesh>
      {[-0.12, 0.02, 0.16].map((y) => (
        <mesh key={`door-panel-${y}`} position={[0, 0.3 + y, -0.286]}>
          <boxGeometry args={[0.43, 0.018, 0.018]} />
          <meshStandardMaterial color="#64748b" roughness={0.5} />
        </mesh>
      ))}
      {[-0.31, 0.31].map((x) => (
        <mesh key={`bumper-${x}`} position={[x, 0.2, -0.285]} castShadow>
          <boxGeometry args={[0.055, 0.34, 0.055]} />
          <meshStandardMaterial color="#1f2937" roughness={0.66} />
        </mesh>
      ))}
      {[-0.28, 0.28].map((x) => (
        <mesh key={`bollard-${x}`} position={[x, 0.13, 0.18]} castShadow>
          <boxGeometry args={[0.055, 0.26, 0.055]} />
          <meshStandardMaterial color="#facc15" roughness={0.5} />
        </mesh>
      ))}
      <mesh position={[0.24, 0.52, -0.22]}>
        <sphereGeometry args={[0.05, 12, 8]} />
        <meshStandardMaterial color={lightColor} emissive={lightColor} emissiveIntensity={0.42} />
      </mesh>
      <mesh position={[0, 0.04, 0.64]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.48, 0.24]} />
        <meshBasicMaterial color="#64748b" transparent opacity={active ? 0.24 : 0.16} depthWrite={false} />
      </mesh>
      <Text position={[0, 0.068, 0.64]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.2} color={active ? "#075985" : modelInk} anchorX="center" anchorY="middle">
        {dockId}
      </Text>
    </group>
  );
}

function DockDoorsModel({ activeDockId, onSelectDock }: { activeDockId: string | null; onSelectDock: (dockId: string, event: SceneClickEvent) => void }) {
  const docks = useAppStore((state) => state.snapshot?.docks) ?? emptyDocks;
  const highlight = useAppStore((state) => state.highlight);
  return (
    <group>
      {dockLayout.map((dock) => {
        const dockState = docks.find((item) => item.id === dock.id);
        return (
          <DockDoorModel
            key={dock.id}
            dockId={dock.id}
            active={activeDockId === dock.id}
            status={dockState?.status}
            highlighted={highlight.docks.includes(dock.id)}
            onClick={(event) => onSelectDock(dock.id, event)}
          />
        );
      })}
    </group>
  );
}

function RfidGateModel({
  checkpoint,
  active,
  onSelect
}: {
  checkpoint: RfidCheckpoint;
  active: boolean;
  onSelect: (gateId: string, event: SceneClickEvent) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const label = checkpoint.name.replace("RFID Gate 1", "Inbound RFID Gate").replace("RFID Gate 2", "Storage Exit RFID Gate").replace("RFID Gate 3", "Dispatch RFID Gate");
  return (
    <group
      position={[checkpoint.position.x, 0.065, checkpoint.position.z]}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(checkpoint.id, event);
      }}
      onPointerOver={(event) => {
        event.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
    >
      {[-0.11, 0.11].map((x) => (
        <mesh key={x} position={[x, 0.22, 0]} castShadow>
          <boxGeometry args={[0.035, 0.42, 0.035]} />
          <meshStandardMaterial color={active ? "#0891b2" : "#0e7490"} roughness={0.48} emissive={active ? "#0891b2" : "#000000"} emissiveIntensity={active ? 0.24 : 0} />
        </mesh>
      ))}
      <mesh position={[0, 0.44, 0]} castShadow>
        <boxGeometry args={[0.28, 0.035, 0.045]} />
        <meshStandardMaterial color={active ? "#67e8f9" : "#22d3ee"} roughness={0.46} />
      </mesh>
      <mesh position={[0, 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.1, 0.13, 24]} />
        <meshBasicMaterial color={active ? "#0891b2" : "#0e7490"} transparent opacity={active ? 0.82 : 0.34} side={THREE.DoubleSide} />
      </mesh>
      {(active || hovered) && (
        <Text position={[0.16, 0.55, 0.1]} rotation={[-0.52, 0, 0]} fontSize={0.056} color={modelInk} anchorX="left">
          {label}
        </Text>
      )}
    </group>
  );
}

function SensorMarkerModel({
  sector,
  index,
  position,
  active,
  onSelect
}: {
  sector: WarehouseSector;
  index: number;
  position: Vec2;
  active: boolean;
  onSelect: (event: SceneClickEvent) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const label = `${sector.name} Sensor`;
  return (
    <group
      position={[position.x, 0.08, position.z]}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(event);
      }}
      onPointerOver={(event) => {
        event.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
    >
      <mesh position={[0, 0.16, 0]} castShadow>
        <cylinderGeometry args={[0.035, 0.035, 0.28, 12]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.55} />
      </mesh>
      <mesh position={[0, 0.32, 0]}>
        <sphereGeometry args={[0.055, 14, 10]} />
        <meshStandardMaterial color={active ? "#0891b2" : "#16a34a"} emissive={active ? "#0891b2" : "#16a34a"} emissiveIntensity={active ? 0.38 : 0.22} />
      </mesh>
      {(active || hovered) && (
        <Text position={[0.12, 0.45, 0.02]} rotation={[-0.55, 0, 0]} fontSize={0.055} color={modelInk} anchorX="left">
          {index > 0 ? `${label} ${index + 1}` : label}
        </Text>
      )}
    </group>
  );
}

function SkuBinMarkerModel({
  bin,
  active
}: {
  bin: WarehouseBin;
  active: boolean;
}) {
  const tone = bin.placement.qualityStatus !== "Released" ? "#ef4444" : bin.coldChainRequired ? "#0284c7" : "#d97706";
  return (
    <group position={[bin.position.x, bin.storageKind === "controlled-area" ? 0.22 : 0.66, bin.position.z]}>
      <mesh castShadow raycast={() => null}>
        <boxGeometry args={[0.24, 0.2, 0.22]} />
        <meshStandardMaterial color={active ? "#0891b2" : tone} roughness={0.62} emissive={active ? "#0891b2" : "#000000"} emissiveIntensity={active ? 0.26 : 0.03} />
      </mesh>
      <mesh position={[0, 0.104, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
        <planeGeometry args={[0.14, 0.09]} />
        <meshBasicMaterial color="#f8fafc" transparent opacity={0.9} />
      </mesh>
    </group>
  );
}

function RouteModel({ route }: { route: InternalRoute }) {
  if (!route.points.length) return null;
  const color = routeColors[route.state];
  const points = route.points.map((point) => toPoint(point, 0.13));
  return (
    <group>
      <Line points={points} color={color} lineWidth={3.2} transparent opacity={0.18} />
      <Line points={points} color={color} lineWidth={1.45} transparent opacity={0.92} />
      {route.blockedPoint && (
        <mesh position={toPoint(route.blockedPoint, 0.16)} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.1, 0.145, 28]} />
          <meshBasicMaterial color="#ff706c" transparent opacity={0.95} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  );
}

function OuterWarehouseShell() {
  const aisleBands = [
    { id: "inbound-corridor", x: -5.18, z: 1.72, width: 0.34, depth: 2.28, color: "#dbeafe", opacity: 0.32 },
    { id: "storage-cross-aisle", x: -2.7, z: -0.43, width: 3.78, depth: 0.22, color: "#d8e3eb", opacity: 0.36 },
    { id: "packing-transfer", x: 1.08, z: 1.2, width: 4.92, depth: 0.22, color: "#e9ddfb", opacity: 0.28 },
    { id: "dock-transfer", x: 1.58, z: 2.48, width: 5.72, depth: 0.2, color: "#f3df9f", opacity: 0.26 }
  ];
  const aisleLines = [
    { id: "receiving-centerline", points: [[-5.18, 0.083, 0.42], [-5.18, 0.083, 2.54]] as Array<[number, number, number]> },
    { id: "storage-centerline", points: [[-4.38, 0.083, -0.43], [-0.84, 0.083, -0.43], [3.72, 0.083, -0.43]] as Array<[number, number, number]> },
    { id: "packing-centerline", points: [[-0.82, 0.083, 1.2], [3.04, 0.083, 1.2], [3.04, 0.083, 1.72], [1.55, 0.083, 1.72]] as Array<[number, number, number]> },
    { id: "dispatch-centerline", points: [[1.55, 0.083, 1.72], [1.55, 0.083, 2.58], [-0.5, 0.083, 2.58], [4.0, 0.083, 2.58]] as Array<[number, number, number]> }
  ];
  return (
    <group>
      <mesh position={[0.1, -0.04, 0.05]} receiveShadow>
        <boxGeometry args={[11.56, 0.08, 7.32]} />
        <meshStandardMaterial color="#d5dee7" roughness={0.94} />
      </mesh>
      <mesh position={[0.1, -0.006, 0.05]} receiveShadow>
        <boxGeometry args={[11.08, 0.06, 6.84]} />
        <meshStandardMaterial color="#edf3f7" roughness={0.9} />
      </mesh>
      <mesh position={[0.1, 0.02, 0.05]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[11.08, 6.84]} />
        <meshStandardMaterial color="#eef4f8" roughness={0.92} />
      </mesh>
      <mesh position={[0.1, 0.13, -3.33]} castShadow receiveShadow>
        <boxGeometry args={[11.08, 0.26, 0.1]} />
        <meshStandardMaterial color={wallMaterial} roughness={0.62} />
      </mesh>
      <mesh position={[-5.72, 0.11, -0.06]} castShadow receiveShadow>
        <boxGeometry args={[0.1, 0.22, 6.4]} />
        <meshStandardMaterial color={wallMaterial} roughness={0.64} />
      </mesh>
      <mesh position={[5.44, 0.11, -0.14]} castShadow receiveShadow>
        <boxGeometry args={[0.1, 0.22, 6.22]} />
        <meshStandardMaterial color={wallMaterial} roughness={0.64} />
      </mesh>
      <mesh position={[-3.42, 0.1, 2.85]} castShadow receiveShadow>
        <boxGeometry args={[4.58, 0.2, 0.1]} />
        <meshStandardMaterial color={wallMaterial} roughness={0.64} />
      </mesh>
      <mesh position={[4.94, 0.1, 2.85]} castShadow receiveShadow>
        <boxGeometry args={[0.88, 0.2, 0.1]} />
        <meshStandardMaterial color={wallMaterial} roughness={0.64} />
      </mesh>
      {aisleBands.map((band) => (
        <mesh key={band.id} position={[band.x, 0.054, band.z]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[band.width, band.depth]} />
          <meshBasicMaterial color={band.color} transparent opacity={band.opacity} depthWrite={false} />
        </mesh>
      ))}
      {aisleLines.map((line) => (
        <Line key={line.id} points={line.points} color="#7890a4" lineWidth={0.9} transparent opacity={0.34} />
      ))}
      <Line points={[[-0.86, 0.086, 2.82], [4.36, 0.086, 2.82]]} color="#d6a742" lineWidth={1.1} transparent opacity={0.46} />
    </group>
  );
}

function WarehouseModelView({
  mode,
  popup,
  routeVisible,
  onOpenPopup,
  onClearSelection
}: {
  mode: WarehouseMode;
  popup: WarehouseModelPopup | null;
  routeVisible: boolean;
  onOpenPopup: (popup: WarehouseModelPopup, event: SceneClickEvent) => void;
  onClearSelection: () => void;
}) {
  const snapshot = useAppStore((state) => state.snapshot)!;
  const highlight = useAppStore((state) => state.highlight);
  const selectedZoneId = useAppStore((state) => state.selectedZoneId);
  const selectedRackId = useAppStore((state) => state.selectedRackId);
  const selectedStockBalanceId = useAppStore((state) => state.selectedStockBalanceId);
  const selectedDockId = useAppStore((state) => state.selectedDockId);
  const selectedStage = useAppStore((state) => state.selectedStage);
  const selectedRfidGateId = useAppStore((state) => state.selectedRfidGateId);
  const setSelectedZone = useAppStore((state) => state.setSelectedZone);
  const setSelectedRack = useAppStore((state) => state.setSelectedRack);
  const setSelectedDock = useAppStore((state) => state.setSelectedDock);
  const setSelectedStage = useAppStore((state) => state.setSelectedStage);
  const setSelectedRfidGate = useAppStore((state) => state.setSelectedRfidGate);
  const bins = useMemo(() => buildWarehouseBins(snapshot.inventoryPlacements), [snapshot.inventoryPlacements]);

  const activeSku = snapshot.inventoryPlacements.find((sku) => sku.stockBalanceId === selectedStockBalanceId) ?? snapshot.inventoryPlacements.find((sku) => highlight.stockBalances.includes(sku.stockBalanceId)) ?? null;
  const activeRack = getRack(selectedRackId) ?? getRackForPlacement(activeSku);
  const activeSector = getSector(selectedZoneId) ?? getSector(activeRack?.zoneId) ?? getSector(activeSku?.zoneId) ?? null;
  const dockId = selectedDockId ?? resolveDockIdForPlacement(activeSku, snapshot.docks);
  const route = buildInternalRoute({
    placement: activeSku,
    rackId: activeRack?.id,
    sectorId: activeSector?.id,
    dockId,
    stage: selectedStage
  });
  const dimOthers = Boolean(activeSector || activeRack || activeSku || selectedRfidGateId);
  const lensSectorIds = mode === "Cold Chain"
    ? new Set(["RCV", "CI", "CS", "DS"])
    : mode === "Dock Flow"
      ? new Set(["RCV", "CI", "PS", "PK", "DS"])
      : mode === "QA Hold"
        ? new Set(["QA", "QT", "PH", "DS"])
        : null;
  const binsForLens = mode === "Cold Chain"
    ? bins.filter((bin) => bin.coldChainRequired)
    : mode === "FEFO"
      ? bins.filter((bin) => isExpiryRisk(bin.placement))
      : mode === "QA Hold"
        ? bins.filter((bin) => bin.placement.qualityStatus !== "Released")
        : mode === "Dock Flow"
          ? bins.filter((bin) => ["Picking", "Packing", "Dock Staging", "Dispatch"].includes(bin.placement.currentStage))
          : bins;
  const visibleBinMarkers = activeRack
    ? binsForLens.filter((bin) => bin.rackId === activeRack.id)
    : activeSector
      ? binsForLens.filter((bin) => bin.placement.zoneId === activeSector.id)
      : binsForLens;
  const sensorSectors = warehouseSectors.filter((sector) => ["CS", "AM", "PH", "DS"].includes(sector.id));

  const selectSector = (sector: WarehouseSector, event: SceneClickEvent) => {
    setSelectedZone(sector.id);
    setSelectedStage(sector.stage);
    onOpenPopup({ type: "zone", id: sector.id, view: "summary" }, event);
  };
  const selectRack = (rack: WarehouseRack, event: SceneClickEvent) => {
    setSelectedZone(rack.zoneId);
    setSelectedRack(rack.id);
    setSelectedStage("Storage");
    onOpenPopup({ type: "rack", id: rack.id, view: "summary" }, event);
  };
  const selectDock = (selectedDock: string, event: SceneClickEvent) => {
    setSelectedDock(selectedDock);
    setSelectedStage("Dispatch");
    onOpenPopup({ type: "dock", id: selectedDock, view: "summary" }, event);
  };
  const selectRfidGate = (gateId: string, event: SceneClickEvent) => {
    setSelectedRfidGate(gateId);
    onOpenPopup({ type: "rfid", id: gateId, view: "summary" }, event);
  };
  const selectSensor = (sector: WarehouseSector, index: number, event: SceneClickEvent) => {
    const sensorLabel = `${sector.name} Sensor`;
    setSelectedZone(sector.id);
    setSelectedStage(sector.stage);
    onOpenPopup({ type: "sensor", id: `${sector.id}-sensor-${index}`, sectorId: sector.id, sensorLabel, view: "summary" }, event);
  };

  return (
    <Canvas
      shadows
      orthographic
      dpr={[1, 1.75]}
      gl={{ antialias: true, alpha: true }}
      style={{ height: "100%", width: "100%" }}
      camera={{ position: [4.8, 8.8, 6.15], zoom: 70, near: 0.1, far: 100 }}
      onPointerMissed={onClearSelection}
    >
      <color attach="background" args={["#dce5ea"]} />
      <fog attach="fog" args={["#dce5ea", 15, 25]} />
      <ambientLight intensity={0.68} />
      <hemisphereLight args={["#f8fbff", "#cbd5e1", 0.46]} />
      <directionalLight
        position={[-4.6, 8.8, 5.6]}
        intensity={1.55}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-8}
        shadow-camera-right={8}
        shadow-camera-top={8}
        shadow-camera-bottom={-8}
        shadow-bias={-0.00018}
      />
      <directionalLight position={[5, 4.2, -4.5]} intensity={0.24} />
      <WarehouseFloorEnvironment />
      <OuterWarehouseShell />
      {warehouseSectors.map((sector) => (
        <RoomModel
          key={sector.id}
          sector={sector}
          active={activeSector?.id === sector.id || highlight.zones.includes(sector.dataZoneId ?? sector.id)}
          dimmed={(dimOthers && activeSector?.id !== sector.id) || Boolean(lensSectorIds && !lensSectorIds.has(sector.id))}
          onClick={(event) => selectSector(sector, event)}
        />
      ))}
      <WorkflowFloorMarkings />
      <ReceivingInspectionDetails />
      <ControlledRoomDetails />
      {warehouseRacks.map((rack) => (
        <RackModel
          key={rack.id}
          rack={rack}
          active={activeRack?.id === rack.id || highlight.racks.includes(rack.id)}
          muted={Boolean((activeSector && activeSector.id !== rack.zoneId && !highlight.racks.includes(rack.id)) || (lensSectorIds && !lensSectorIds.has(rack.zoneId)))}
          onClick={(event) => selectRack(rack, event)}
        />
      ))}
      <PurposefulPallets />
      <PackingBench onSelect={(event) => {
        const sector = getSector("PK");
        if (sector) selectSector(sector, event);
      }} />
      {visibleBinMarkers.map((bin) => (
        <SkuBinMarkerModel key={bin.id} bin={bin} active={selectedStockBalanceId === bin.placement.stockBalanceId} />
      ))}
      {sensorSectors.map((sector) => {
        const sensor = sector.sensors[0];
        if (!sensor) return null;
        return (
          <SensorMarkerModel
            key={`${sector.id}-sensor-0`}
            sector={sector}
            index={0}
            position={sensor}
            active={popup?.type === "sensor" && popup.id === `${sector.id}-sensor-0`}
            onSelect={(event) => selectSensor(sector, 0, event)}
          />
        );
      })}
      {rfidCheckpoints.map((checkpoint) => (
        <RfidGateModel key={checkpoint.id} checkpoint={checkpoint} active={selectedRfidGateId === checkpoint.id} onSelect={selectRfidGate} />
      ))}
      <DockDoorsModel activeDockId={dockId} onSelectDock={selectDock} />
      {routeVisible && <RouteModel route={route} />}
      <ContactShadows position={[0.05, -0.065, 0.08]} opacity={0.26} scale={13.5} blur={2.4} far={4.2} color="#64748b" />
      <OrbitControls makeDefault enabled={!popup} enablePan={false} minZoom={52} maxZoom={90} maxPolarAngle={Math.PI / 2.15} target={[0.05, 0.18, 0.3]} />
    </Canvas>
  );
}

export default WarehouseModelView;
