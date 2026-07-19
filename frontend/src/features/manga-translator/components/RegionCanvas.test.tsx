import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BlockItem } from "../types";
import { RegionCanvas } from "./RegionCanvas";

vi.mock("@iconify-icon/react", () => ({
  Icon: ({ icon }: { icon: string }) => <span data-icon={icon} />,
}));

const initialBlock: BlockItem = {
  id: "region-1",
  box: { x: 0.1, y: 0.2, width: 0.2, height: 0.1 },
  source: "detected",
  text: "source",
  translated_text: "translation",
};

function canvasBounds(): DOMRect {
  return {
    bottom: 100,
    height: 100,
    left: 0,
    right: 100,
    top: 0,
    width: 100,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  };
}

function renderCanvas({
  blocks = [initialBlock],
  selectedBlockId = null,
}: {
  blocks?: BlockItem[];
  selectedBlockId?: string | null;
} = {}) {
  const onChange = vi.fn();
  const onCommit = vi.fn();
  const onSelect = vi.fn();

  render(
    <RegionCanvas
      imageUrl="/page.png"
      blocks={blocks}
      selectedBlockId={selectedBlockId}
      onChange={onChange}
      onCommit={onCommit}
      onSelect={onSelect}
    />,
  );

  const svg = screen.getByLabelText("Editable manga text regions") as unknown as SVGSVGElement;
  vi.spyOn(svg, "getBoundingClientRect").mockReturnValue(canvasBounds());
  return { onChange, onCommit, onSelect, svg };
}

describe("RegionCanvas", () => {
  it("creates and commits a normalized manual region", () => {
    const { onCommit, onSelect, svg } = renderCanvas({ blocks: [] });

    fireEvent.click(screen.getByRole("button", { name: "Add region" }));
    fireEvent.pointerDown(svg, { pointerId: 1, clientX: 10, clientY: 20 });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 40, clientY: 50 });
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: 40, clientY: 50 });

    expect(onCommit).toHaveBeenCalledOnce();
    const [created] = onCommit.mock.calls[0][0] as BlockItem[];
    expect(created).toMatchObject({
      source: "manual",
      text: "",
      translated_text: "",
    });
    expect(created.box.x).toBeCloseTo(0.1);
    expect(created.box.y).toBeCloseTo(0.2);
    expect(created.box.width).toBeCloseTo(0.3);
    expect(created.box.height).toBeCloseTo(0.3);
    expect(onSelect).toHaveBeenLastCalledWith(created.id);
  });

  it("moves a region and persists the normalized result", () => {
    const { onChange, onCommit, svg } = renderCanvas({
      selectedBlockId: initialBlock.id,
    });
    const region = screen.getByRole("button", {
      name: "Select and move region 1",
    });

    fireEvent.pointerDown(region, { pointerId: 2, clientX: 20, clientY: 25 });
    fireEvent.pointerMove(svg, { pointerId: 2, clientX: 40, clientY: 45 });
    fireEvent.pointerUp(svg, { pointerId: 2, clientX: 40, clientY: 45 });

    const committed = onCommit.mock.calls[0][0] as BlockItem[];
    expect(committed[0].box).toEqual({
      x: 0.3,
      y: 0.4,
      width: 0.2,
      height: 0.1,
    });
    expect(onChange).toHaveBeenLastCalledWith(committed);
  });

  it("resizes a region from its southeast handle", () => {
    const { onCommit, svg } = renderCanvas({ selectedBlockId: initialBlock.id });
    const handles = svg.querySelectorAll<SVGRectElement>('rect[fill="transparent"]');

    fireEvent.pointerDown(handles[2], { pointerId: 3, clientX: 30, clientY: 30 });
    fireEvent.pointerMove(svg, { pointerId: 3, clientX: 50, clientY: 50 });
    fireEvent.pointerUp(svg, { pointerId: 3, clientX: 50, clientY: 50 });

    const committed = onCommit.mock.calls[0][0] as BlockItem[];
    expect(committed[0].box).toEqual({
      x: 0.1,
      y: 0.2,
      width: 0.4,
      height: 0.3,
    });
  });

  it("deletes the selected region and persists the empty collection", () => {
    const { onChange, onCommit, onSelect } = renderCanvas({
      selectedBlockId: initialBlock.id,
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(onChange).toHaveBeenCalledWith([]);
    expect(onCommit).toHaveBeenCalledWith([]);
    expect(onSelect).toHaveBeenCalledWith(null);
  });
});
