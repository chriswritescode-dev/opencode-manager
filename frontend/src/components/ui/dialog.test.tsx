import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "./dialog";

describe("DialogContent", () => {
  it("applies safe-area padding when fullscreen prop is true", () => {
    render(
      <Dialog open>
        <DialogContent fullscreen data-testid="dialog-content">
          <DialogHeader>
            <DialogTitle>Test Dialog</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
    const content = screen.getByTestId("dialog-content");
    expect(content).toHaveStyle({ paddingTop: "env(safe-area-inset-top, 0px)" });
  });

  it("applies safe-area padding when mobileFullscreen prop is true", () => {
    render(
      <Dialog open>
        <DialogContent mobileFullscreen data-testid="dialog-content">
          <DialogHeader>
            <DialogTitle>Test Dialog</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
    const content = screen.getByTestId("dialog-content");
    expect(content).toHaveStyle({ paddingTop: "env(safe-area-inset-top, 0px)" });
  });

  it("applies inset-0 for fullscreen dialogs", () => {
    render(
      <Dialog open>
        <DialogContent fullscreen data-testid="dialog-content">
          Content
        </DialogContent>
      </Dialog>
    );
    const content = screen.getByTestId("dialog-content");
    expect(content).toHaveClass("inset-0");
  });

  it("applies inset-0 for mobileFullscreen dialogs", () => {
    render(
      <Dialog open>
        <DialogContent mobileFullscreen data-testid="dialog-content">
          Content
        </DialogContent>
      </Dialog>
    );
    const content = screen.getByTestId("dialog-content");
    expect(content).toHaveClass("inset-0");
  });

  it("does not apply safe-area padding when neither fullscreen nor mobileFullscreen", () => {
    render(
      <Dialog open>
        <DialogContent data-testid="dialog-content">
          Content
        </DialogContent>
      </Dialog>
    );
    const content = screen.getByTestId("dialog-content");
    const style = content.getAttribute("style") || "";
    expect(style).not.toContain("safe-area");
    expect(content).not.toHaveClass("inset-0");
  });

  it("hides close button when fullscreen is true", () => {
    render(
      <Dialog open>
        <DialogContent fullscreen data-testid="dialog-content">
          Content
        </DialogContent>
      </Dialog>
    );
    expect(screen.queryByRole("button", { name: /close/i })).not.toBeInTheDocument();
  });

  it("shows close button when mobileFullscreen is true", () => {
    render(
      <Dialog open>
        <DialogContent mobileFullscreen data-testid="dialog-content">
          Content
        </DialogContent>
      </Dialog>
    );
    expect(screen.getByRole("button", { name: /close/i })).toBeInTheDocument();
  });

  it("hides close button when hideCloseButton is true", () => {
    render(
      <Dialog open>
        <DialogContent hideCloseButton data-testid="dialog-content">
          Content
        </DialogContent>
      </Dialog>
    );
    expect(screen.queryByRole("button", { name: /close/i })).not.toBeInTheDocument();
  });

  it("merges custom className with default classes", () => {
    render(
      <Dialog open>
        <DialogContent className="custom-class" data-testid="dialog-content">
          Content
        </DialogContent>
      </Dialog>
    );
    const content = screen.getByTestId("dialog-content");
    expect(content).toHaveClass("custom-class");
    expect(content).toHaveClass("fixed");
    expect(content).toHaveClass("z-50");
  });

  it("renders children correctly", () => {
    render(
      <Dialog open>
        <DialogContent>
          <span>Test Child Content</span>
        </DialogContent>
      </Dialog>
    );
    expect(screen.getByText("Test Child Content")).toBeInTheDocument();
  });
});
