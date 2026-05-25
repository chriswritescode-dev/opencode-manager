import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "./dialog";

function withMobileViewport(fn: () => void) {
  const originalWidth = window.innerWidth
  Object.defineProperty(window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: 375,
  })
  fn()
  Object.defineProperty(window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: originalWidth,
  })
}

describe("DialogContent", () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 375,
    })
  })

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
    expect(content).toHaveClass("z-[70]");
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

  it("accepts mobileSwipeToClose prop without breaking rendering", () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent mobileFullscreen mobileSwipeToClose data-testid="dialog-content">
          <DialogHeader>
            <DialogTitle>Swipe Dialog</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
    const content = screen.getByTestId("dialog-content");
    expect(content).toBeInTheDocument();
    expect(content).toHaveClass("inset-0");
  });

  it("applies safe-area padding when mobileSwipeToClose is used with mobileFullscreen", () => {
    render(
      <Dialog open>
        <DialogContent mobileFullscreen mobileSwipeToClose data-testid="dialog-content">
          <DialogHeader>
            <DialogTitle>Test Dialog</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
    const content = screen.getByTestId("dialog-content");
    expect(content).toHaveStyle({ paddingTop: "env(safe-area-inset-top, 0px)" });
  });

  it('renders hidden close trigger by default on mobile', () => {
    withMobileViewport(() => {
      const onOpenChange = vi.fn();
      render(
        <Dialog open onOpenChange={onOpenChange}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Swipe Dialog</DialogTitle>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      );
      const closeTrigger = document.querySelector('[data-swipe-close-trigger]');
      expect(closeTrigger).toBeInTheDocument();
    });
  });

  it('does not render hidden close trigger when mobileSwipeToClose is false', () => {
    withMobileViewport(() => {
      render(
        <Dialog open>
          <DialogContent mobileSwipeToClose={false}>
            <DialogHeader>
              <DialogTitle>Swipe Dialog</DialogTitle>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      );
      const closeTrigger = document.querySelector('[data-swipe-close-trigger]');
      expect(closeTrigger).not.toBeInTheDocument();
    });
  });

  it('closes dialog when hidden close trigger is activated', () => {
    withMobileViewport(() => {
      const onOpenChange = vi.fn();
      render(
        <Dialog open onOpenChange={onOpenChange}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Swipe Dialog</DialogTitle>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      );
      
      const closeTrigger = document.querySelector('[data-swipe-close-trigger]') as HTMLButtonElement | null;
      expect(closeTrigger).toBeInTheDocument();
      
      if (closeTrigger) {
        closeTrigger.click();
        expect(onOpenChange).toHaveBeenCalledWith(false);
      }
    });
  });

  it('calls onSwipeBack when canSwipeBack is true and swipe completes', () => {
    withMobileViewport(() => {
      const mockOnSwipeBack = vi.fn();
      const onOpenChange = vi.fn();
      render(
        <Dialog open onOpenChange={onOpenChange}>
          <DialogContent
            canSwipeBack={() => true}
            onSwipeBack={mockOnSwipeBack}
            data-testid="swipe-dialog"
          >
            Content
          </DialogContent>
        </Dialog>
      );
      
      const content = screen.getByTestId('swipe-dialog');

      content.dispatchEvent(new TouchEvent('touchstart', {
        touches: [{ clientX: 10, clientY: 100 }] as any,
      }));
      content.dispatchEvent(new TouchEvent('touchmove', {
        touches: [{ clientX: 100, clientY: 100 }] as any,
      }));
      content.dispatchEvent(new TouchEvent('touchend', {
        changedTouches: [{ clientX: 100, clientY: 100 }] as any,
      }));
      
      expect(mockOnSwipeBack).toHaveBeenCalled();
      expect(onOpenChange).not.toHaveBeenCalled();
    });
  });

  it('attempts close when canSwipeBack is false and swipe completes', () => {
    withMobileViewport(() => {
      const mockOnSwipeBack = vi.fn();
      const onOpenChange = vi.fn();
      render(
        <Dialog open onOpenChange={onOpenChange}>
          <DialogContent
            canSwipeBack={() => false}
            onSwipeBack={mockOnSwipeBack}
            data-testid="swipe-dialog"
          >
            Content
          </DialogContent>
        </Dialog>
      );
      
      const content = screen.getByTestId('swipe-dialog');
      content.dispatchEvent(new TouchEvent('touchstart', {
        touches: [{ clientX: 10, clientY: 100 }] as any,
      }));
      content.dispatchEvent(new TouchEvent('touchmove', {
        touches: [{ clientX: 100, clientY: 100 }] as any,
      }));
      content.dispatchEvent(new TouchEvent('touchend', {
        changedTouches: [{ clientX: 100, clientY: 100 }] as any,
      }));
      
      expect(mockOnSwipeBack).not.toHaveBeenCalled();
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('applies safe-area style and hidden trigger for mobileFullscreen', () => {
    withMobileViewport(() => {
      render(
        <Dialog open>
          <DialogContent mobileFullscreen data-testid="dialog-content">
            Content
          </DialogContent>
        </Dialog>
      );
      const content = screen.getByTestId("dialog-content");
      expect(content).toHaveStyle({ paddingTop: "env(safe-area-inset-top, 0px)" });
      expect(document.querySelector('[data-swipe-close-trigger]')).toBeInTheDocument();
    });
  });

  it('does not apply transform styles to non-fullscreen dialogs', () => {
    withMobileViewport(() => {
      render(
        <Dialog open>
          <DialogContent data-testid="dialog-content">
            Content
          </DialogContent>
        </Dialog>
      );
      const content = screen.getByTestId("dialog-content");
      const style = content.getAttribute("style") || "";
      expect(style).not.toMatch(/transform/);
    });
  });

  it('applies swipe transform to fullscreen dialogs during touchmove', () => {
    withMobileViewport(() => {
      render(
        <Dialog open>
          <DialogContent fullscreen data-testid="dialog-content">
            Content
          </DialogContent>
        </Dialog>
      );
      const content = screen.getByTestId("dialog-content");
      content.dispatchEvent(new TouchEvent('touchstart', {
        touches: [{ clientX: 10, clientY: 100 }] as any,
      }));
      content.dispatchEvent(new TouchEvent('touchmove', {
        touches: [{ clientX: 50, clientY: 100 }] as any,
      }));
      
      const style = content.getAttribute("style") || "";
      expect(style).toMatch(/transform/);
    });
  });

  it('does not apply swipe transform to non-fullscreen dialogs during touchmove', () => {
    withMobileViewport(() => {
      render(
        <Dialog open>
          <DialogContent data-testid="dialog-content">
            Content
          </DialogContent>
        </Dialog>
      );
      const content = screen.getByTestId("dialog-content");
      content.dispatchEvent(new TouchEvent('touchstart', {
        touches: [{ clientX: 10, clientY: 100 }] as any,
      }));
      content.dispatchEvent(new TouchEvent('touchmove', {
        touches: [{ clientX: 50, clientY: 100 }] as any,
      }));
      
      const style = content.getAttribute("style") || "";
      expect(style).not.toMatch(/transform/);
    });
  });

  it('binds swipe handler when mobileSwipeToClose and mobileFullscreen are enabled', () => {
    withMobileViewport(() => {
      const onOpenChange = vi.fn();
      render(
        <Dialog open onOpenChange={onOpenChange}>
          <DialogContent mobileFullscreen mobileSwipeToClose data-testid="swipe-dialog">
            <DialogHeader>
              <DialogTitle>Swipe Dialog</DialogTitle>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      );
      
      const content = screen.getByTestId('swipe-dialog');
      const closeTrigger = document.querySelector('[data-swipe-close-trigger]') as HTMLButtonElement | null;
      
      expect(content).toBeInTheDocument();
      expect(closeTrigger).toBeInTheDocument();
      
      const clickSpy = vi.spyOn(closeTrigger as HTMLButtonElement, 'click');
      closeTrigger?.click();
      
      expect(clickSpy).toHaveBeenCalled();
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});
