"use client";

import { Icon } from "@iconify-icon/react";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { BlockItem, NormalizedBox } from "../types";

const MIN_REGION_SIZE = 0.025;
const HANDLE_SIZE = 1.6;
const HANDLE_HIT_SIZE = 5;

type ResizeHandle = "nw" | "ne" | "se" | "sw";

type Interaction =
  | {
      kind: "create";
      pointerId: number;
      start: Point;
      snapshot: BlockItem[];
    }
  | {
      kind: "move";
      pointerId: number;
      start: Point;
      initial: NormalizedBox;
      regionId: string;
      snapshot: BlockItem[];
    }
  | {
      kind: "resize";
      pointerId: number;
      start: Point;
      initial: NormalizedBox;
      regionId: string;
      handle: ResizeHandle;
      snapshot: BlockItem[];
    };

interface Point {
  x: number;
  y: number;
}

interface PendingUpdate {
  regionId?: string;
  box: NormalizedBox;
}

export interface TypesetPreviewOverlayItem {
  base64?: string;
  mimeType?: string;
  bounds?: { x: number; y: number; width: number; height: number };
  loading?: boolean;
  error?: string | null;
}

interface RegionCanvasProps {
  imageUrl: string;
  blocks: BlockItem[];
  selectedBlockId: string | null;
  previewOverlays?: Record<string, TypesetPreviewOverlayItem>;
  disabled?: boolean;
  maskPreviewUrl?: string;
  maskPreviewState?: MaskPreviewState;
  showMaskPreview?: boolean;
  onChange: (blocks: BlockItem[]) => void;
  onCommit: (blocks: BlockItem[]) => void;
  onSelect: (blockId: string | null) => void;
  onToggleMaskPreview?: () => void;
}

export type MaskPreviewState = "idle" | "loading" | "ready" | "stale" | "error";

interface RegionShapeProps {
  block: BlockItem;
  index: number;
  selected: boolean;
  snapshot: BlockItem[];
  onBegin: (
    event: ReactPointerEvent<SVGElement>,
    block: BlockItem,
    snapshot: BlockItem[],
    handle?: ResizeHandle,
  ) => void;
  onSelect: (blockId: string) => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function pointFromEvent(event: ReactPointerEvent<SVGSVGElement>): Point {
  const bounds = event.currentTarget.getBoundingClientRect();
  return {
    x: clamp((event.clientX - bounds.left) / bounds.width, 0, 1),
    y: clamp((event.clientY - bounds.top) / bounds.height, 0, 1),
  };
}

function creationBox(start: Point, current: Point): NormalizedBox {
  return {
    x: Math.min(start.x, current.x),
    y: Math.min(start.y, current.y),
    width: Math.abs(current.x - start.x),
    height: Math.abs(current.y - start.y),
  };
}

function movedBox(initial: NormalizedBox, start: Point, current: Point): NormalizedBox {
  return {
    ...initial,
    x: clamp(initial.x + current.x - start.x, 0, 1 - initial.width),
    y: clamp(initial.y + current.y - start.y, 0, 1 - initial.height),
  };
}

function resizedBox(
  initial: NormalizedBox,
  current: Point,
  handle: ResizeHandle,
): NormalizedBox {
  const right = initial.x + initial.width;
  const bottom = initial.y + initial.height;
  const movesLeft = handle === "nw" || handle === "sw";
  const movesTop = handle === "nw" || handle === "ne";
  const x = movesLeft
    ? clamp(current.x, 0, right - MIN_REGION_SIZE)
    : initial.x;
  const y = movesTop
    ? clamp(current.y, 0, bottom - MIN_REGION_SIZE)
    : initial.y;
  const nextRight = movesLeft
    ? right
    : clamp(current.x, initial.x + MIN_REGION_SIZE, 1);
  const nextBottom = movesTop
    ? bottom
    : clamp(current.y, initial.y + MIN_REGION_SIZE, 1);

  return { x, y, width: nextRight - x, height: nextBottom - y };
}

function newRegionId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `region-${Date.now()}`;
}

function RegionShape({
  block,
  index,
  selected,
  snapshot,
  onBegin,
  onSelect,
}: RegionShapeProps) {
  const x = block.box.x * 100;
  const y = block.box.y * 100;
  const width = block.box.width * 100;
  const height = block.box.height * 100;
  const handles: Array<[ResizeHandle, number, number]> = [
    ["nw", x, y],
    ["ne", x + width, y],
    ["se", x + width, y + height],
    ["sw", x, y + height],
  ];

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        role="button"
        tabIndex={0}
        aria-label={`Select and move region ${index + 1}`}
        vectorEffect="non-scaling-stroke"
        onPointerDown={event => onBegin(event, block, snapshot)}
        onFocus={() => onSelect(block.id)}
        onKeyDown={event => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect(block.id);
          }
        }}
        className={`cursor-move stroke-2 outline-none transition-colors focus:stroke-white ${
          selected
            ? "fill-cyan-400/15 stroke-yellow-300"
            : "fill-cyan-500/5 stroke-cyan-400 hover:fill-cyan-400/15"
        }`}
      />
      <text
        x={x + 1}
        y={y + 3}
        vectorEffect="non-scaling-stroke"
        className="pointer-events-none fill-yellow-200 font-mono text-[3px] font-bold"
      >
        {index + 1}
      </text>
      {selected
        ? handles.map(([handle, handleX, handleY]) => (
            <g key={handle}>
              <rect
                x={handleX - HANDLE_HIT_SIZE / 2}
                y={handleY - HANDLE_HIT_SIZE / 2}
                width={HANDLE_HIT_SIZE}
                height={HANDLE_HIT_SIZE}
                fill="transparent"
                className="cursor-nwse-resize"
                onPointerDown={event => onBegin(event, block, snapshot, handle)}
              />
              <rect
                x={handleX - HANDLE_SIZE / 2}
                y={handleY - HANDLE_SIZE / 2}
                width={HANDLE_SIZE}
                height={HANDLE_SIZE}
                vectorEffect="non-scaling-stroke"
                className="pointer-events-none fill-yellow-300 stroke-black stroke-1"
              />
            </g>
          ))
        : null}
    </g>
  );
}

export function RegionCanvas({
  imageUrl,
  blocks,
  selectedBlockId,
  previewOverlays,
  disabled = false,
  maskPreviewUrl,
  maskPreviewState = "idle",
  showMaskPreview = false,
  onChange,
  onCommit,
  onSelect,
  onToggleMaskPreview,
}: RegionCanvasProps) {
  const [addMode, setAddMode] = useState(false);
  const [draftBox, setDraftBox] = useState<NormalizedBox | null>(null);
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(null);
  const blocksRef = useRef(blocks);
  const interactionRef = useRef<Interaction | null>(null);
  const pendingRef = useRef<PendingUpdate | null>(null);
  const frameRef = useRef<number | null>(null);
  const draftRef = useRef<NormalizedBox | null>(null);

  useEffect(() => {
    setImageDimensions(null);
  }, [imageUrl]);

  useEffect(() => {
    blocksRef.current = blocks;
  }, [blocks]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  const applyPending = () => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    frameRef.current = null;
    if (!pending) return;

    if (!pending.regionId) {
      setDraftBox(pending.box);
      return;
    }

    const nextBlocks = blocksRef.current.map(block =>
      block.id === pending.regionId ? { ...block, box: pending.box } : block,
    );
    blocksRef.current = nextBlocks;
    onChange(nextBlocks);
  };

  const scheduleUpdate = (pending: PendingUpdate) => {
    pendingRef.current = pending;
    if (frameRef.current === null) {
      frameRef.current = requestAnimationFrame(applyPending);
    }
  };

  const flushPending = () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    applyPending();
  };

  const beginRegionInteraction = (
    event: ReactPointerEvent<SVGElement>,
    block: BlockItem,
    snapshot: BlockItem[],
    handle?: ResizeHandle,
  ) => {
    if (disabled) return;
    event.preventDefault();
    event.stopPropagation();
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return;
    svg.setPointerCapture(event.pointerId);
    const bounds = svg.getBoundingClientRect();
    const start = {
      x: clamp((event.clientX - bounds.left) / bounds.width, 0, 1),
      y: clamp((event.clientY - bounds.top) / bounds.height, 0, 1),
    };
    onSelect(block.id);
    interactionRef.current = handle
      ? {
          kind: "resize",
          pointerId: event.pointerId,
          start,
          initial: block.box,
          regionId: block.id,
          handle,
          snapshot,
        }
      : {
          kind: "move",
          pointerId: event.pointerId,
          start,
          initial: block.box,
          regionId: block.id,
          snapshot,
        };
  };

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (disabled || event.target !== event.currentTarget) return;
    if (!addMode) {
      onSelect(null);
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = pointFromEvent(event);
    interactionRef.current = {
      kind: "create",
      pointerId: event.pointerId,
      start,
      snapshot: blocksRef.current,
    };
    const box = { x: start.x, y: start.y, width: 0, height: 0 };
    draftRef.current = box;
    setDraftBox(box);
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    event.preventDefault();
    const current = pointFromEvent(event);

    if (interaction.kind === "create") {
      const box = creationBox(interaction.start, current);
      draftRef.current = box;
      scheduleUpdate({ box });
      return;
    }

    const box =
      interaction.kind === "move"
        ? movedBox(interaction.initial, interaction.start, current)
        : resizedBox(interaction.initial, current, interaction.handle);
    scheduleUpdate({ regionId: interaction.regionId, box });
  };

  const finishInteraction = (event: ReactPointerEvent<SVGSVGElement>) => {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    event.preventDefault();
    flushPending();
    interactionRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (interaction.kind === "create") {
      const box = draftRef.current;
      draftRef.current = null;
      setDraftBox(null);
      if (!box || box.width < MIN_REGION_SIZE || box.height < MIN_REGION_SIZE) return;
      const region: BlockItem = {
        id: newRegionId(),
        box,
        source: "manual",
        text: "",
        translated_text: "",
      };
      const nextBlocks = [...blocksRef.current, region];
      blocksRef.current = nextBlocks;
      onSelect(region.id);
      onChange(nextBlocks);
      onCommit(nextBlocks);
      setAddMode(false);
      return;
    }

    onCommit(blocksRef.current);
  };

  const cancelInteraction = (event: ReactPointerEvent<SVGSVGElement>) => {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    pendingRef.current = null;
    interactionRef.current = null;
    draftRef.current = null;
    setDraftBox(null);
    blocksRef.current = interaction.snapshot;
    onChange(interaction.snapshot);
  };

  const deleteSelected = () => {
    if (!selectedBlockId || disabled) return;
    const nextBlocks = blocksRef.current.filter(block => block.id !== selectedBlockId);
    blocksRef.current = nextBlocks;
    onSelect(null);
    onChange(nextBlocks);
    onCommit(nextBlocks);
  };

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Visual region editor">
      <div className="flex flex-wrap items-center gap-2 border-b border-[#222] bg-[#0c0c0c] px-3 py-2">
        <button
          type="button"
          aria-pressed={addMode}
          disabled={disabled}
          onClick={() => setAddMode(current => !current)}
          className={`flex min-h-10 items-center gap-2 border px-3 font-mono text-[11px] font-bold uppercase tracking-wider transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
            addMode
              ? "border-cyan-400 bg-cyan-400 text-black"
              : "border-[#333] text-cyan-400 hover:border-cyan-500"
          }`}
        >
          <Icon icon="solar:crop-minimalistic-linear" />
          {addMode ? "Draw on page" : "Add region"}
        </button>
        <button
          type="button"
          disabled={!selectedBlockId || disabled}
          onClick={deleteSelected}
          className="flex min-h-10 items-center gap-2 border border-[#333] px-3 font-mono text-[11px] font-bold uppercase tracking-wider text-red-400 transition-colors hover:border-red-500 disabled:cursor-not-allowed disabled:opacity-35"
        >
          <Icon icon="solar:trash-bin-trash-linear" />
          Delete
        </button>
        <button
          type="button"
          aria-pressed={showMaskPreview}
          disabled={disabled || maskPreviewState === "loading"}
          onClick={onToggleMaskPreview}
          className="flex min-h-10 items-center gap-2 border border-[#333] px-3 font-mono text-[11px] font-bold uppercase tracking-wider text-yellow-300 transition-colors hover:border-yellow-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Icon
            icon={
              maskPreviewState === "loading"
                ? "eos-icons:loading"
                : showMaskPreview
                  ? "solar:eye-closed-linear"
                  : "solar:eye-linear"
            }
          />
          {maskPreviewState === "stale"
            ? "Regenerate mask"
            : showMaskPreview
              ? "Hide mask"
              : "Mask preview"}
        </button>
        <p className="ml-auto text-[10px] font-mono uppercase tracking-wider text-[#666]">
          {addMode ? "Drag an empty area to create" : "Drag a region or its corner handles"}
        </p>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-[#090909] p-3 sm:p-6">
        <div className="relative inline-flex max-h-full max-w-full border border-[#222] bg-black">
          {/* The SVG shares this image's rendered box, so normalized coordinates stay aligned. */}
          <img
            src={imageUrl}
            alt="Manga page being reviewed"
            draggable={false}
            onLoad={e => {
              const img = e.currentTarget;
              if (img.naturalWidth && img.naturalHeight) {
                setImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
              }
            }}
            className="block max-h-[calc(100dvh-13rem)] max-w-full select-none object-contain lg:max-h-[calc(100dvh-9rem)]"
          />
          {showMaskPreview && maskPreviewUrl ? (
            <img
              src={maskPreviewUrl}
              alt=""
              aria-hidden="true"
              draggable={false}
              className="pointer-events-none absolute inset-0 h-full w-full select-none"
            />
          ) : null}
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-label="Editable manga text regions"
            className={`absolute inset-0 h-full w-full touch-none select-none ${
              addMode ? "cursor-crosshair" : "cursor-default"
            }`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishInteraction}
            onPointerCancel={cancelInteraction}
          >
            {blocks.map(block => {
              const overlay = previewOverlays?.[block.id];
              if (!overlay?.base64 || !overlay.bounds || !imageDimensions) return null;
              const { bounds, base64, mimeType } = overlay;
              const x = (bounds.x / imageDimensions.width) * 100;
              const y = (bounds.y / imageDimensions.height) * 100;
              const width = (bounds.width / imageDimensions.width) * 100;
              const height = (bounds.height / imageDimensions.height) * 100;

              return (
                <image
                  key={`preview-crop-${block.id}`}
                  href={`data:${mimeType || "image/png"};base64,${base64}`}
                  x={x}
                  y={y}
                  width={width}
                  height={height}
                  preserveAspectRatio="none"
                  className="pointer-events-none opacity-90 transition-opacity"
                />
              );
            })}
            {blocks.map((block, index) => (
              <RegionShape
                key={block.id}
                block={block}
                index={index}
                selected={selectedBlockId === block.id}
                snapshot={blocks}
                onBegin={beginRegionInteraction}
                onSelect={onSelect}
              />
            ))}
            {draftBox ? (
              <rect
                x={draftBox.x * 100}
                y={draftBox.y * 100}
                width={draftBox.width * 100}
                height={draftBox.height * 100}
                vectorEffect="non-scaling-stroke"
                className="pointer-events-none fill-yellow-300/10 stroke-yellow-300 stroke-2 [stroke-dasharray:6_4]"
              />
            ) : null}
          </svg>
        </div>
      </div>
    </section>
  );
}
