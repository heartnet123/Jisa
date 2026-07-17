import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);

class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;

  constructor(type: string, parameters: PointerEventInit = {}) {
    super(type, parameters);
    this.pointerId = parameters.pointerId ?? 0;
  }
}

Object.defineProperty(globalThis, "PointerEvent", {
  configurable: true,
  value: TestPointerEvent,
});

Object.defineProperties(globalThis, {
  requestAnimationFrame: {
    configurable: true,
    value(callback: FrameRequestCallback) {
      return window.setTimeout(() => callback(performance.now()), 16);
    },
  },
  cancelAnimationFrame: {
    configurable: true,
    value(handle: number) {
      window.clearTimeout(handle);
    },
  },
});

Object.defineProperties(SVGSVGElement.prototype, {
  setPointerCapture: {
    configurable: true,
    value() {},
  },
  releasePointerCapture: {
    configurable: true,
    value() {},
  },
  hasPointerCapture: {
    configurable: true,
    value() {
      return true;
    },
  },
});

Object.defineProperty(Element.prototype, "scrollIntoView", {
  configurable: true,
  value() {},
});
