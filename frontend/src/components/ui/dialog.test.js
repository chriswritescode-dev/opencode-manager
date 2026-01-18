"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var vitest_1 = require("vitest");
var react_1 = require("@testing-library/react");
var dialog_1 = require("./dialog");
(0, vitest_1.describe)("DialogContent", function () {
    (0, vitest_1.it)("applies safe-area padding when fullscreen prop is true", function () {
        (0, react_1.render)(<dialog_1.Dialog open>
        <dialog_1.DialogContent fullscreen data-testid="dialog-content">
          <dialog_1.DialogHeader>
            <dialog_1.DialogTitle>Test Dialog</dialog_1.DialogTitle>
          </dialog_1.DialogHeader>
        </dialog_1.DialogContent>
      </dialog_1.Dialog>);
        var content = react_1.screen.getByTestId("dialog-content");
        (0, vitest_1.expect)(content).toHaveStyle({ paddingTop: "env(safe-area-inset-top, 0px)" });
    });
    (0, vitest_1.it)("applies safe-area padding when mobileFullscreen prop is true", function () {
        (0, react_1.render)(<dialog_1.Dialog open>
        <dialog_1.DialogContent mobileFullscreen data-testid="dialog-content">
          <dialog_1.DialogHeader>
            <dialog_1.DialogTitle>Test Dialog</dialog_1.DialogTitle>
          </dialog_1.DialogHeader>
        </dialog_1.DialogContent>
      </dialog_1.Dialog>);
        var content = react_1.screen.getByTestId("dialog-content");
        (0, vitest_1.expect)(content).toHaveStyle({ paddingTop: "env(safe-area-inset-top, 0px)" });
    });
    (0, vitest_1.it)("applies inset-0 for fullscreen dialogs", function () {
        (0, react_1.render)(<dialog_1.Dialog open>
        <dialog_1.DialogContent fullscreen data-testid="dialog-content">
          Content
        </dialog_1.DialogContent>
      </dialog_1.Dialog>);
        var content = react_1.screen.getByTestId("dialog-content");
        (0, vitest_1.expect)(content).toHaveClass("inset-0");
    });
    (0, vitest_1.it)("applies inset-0 for mobileFullscreen dialogs", function () {
        (0, react_1.render)(<dialog_1.Dialog open>
        <dialog_1.DialogContent mobileFullscreen data-testid="dialog-content">
          Content
        </dialog_1.DialogContent>
      </dialog_1.Dialog>);
        var content = react_1.screen.getByTestId("dialog-content");
        (0, vitest_1.expect)(content).toHaveClass("inset-0");
    });
    (0, vitest_1.it)("does not apply safe-area padding when neither fullscreen nor mobileFullscreen", function () {
        (0, react_1.render)(<dialog_1.Dialog open>
        <dialog_1.DialogContent data-testid="dialog-content">
          Content
        </dialog_1.DialogContent>
      </dialog_1.Dialog>);
        var content = react_1.screen.getByTestId("dialog-content");
        var style = content.getAttribute("style") || "";
        (0, vitest_1.expect)(style).not.toContain("safe-area");
        (0, vitest_1.expect)(content).not.toHaveClass("inset-0");
    });
    (0, vitest_1.it)("hides close button when fullscreen is true", function () {
        (0, react_1.render)(<dialog_1.Dialog open>
        <dialog_1.DialogContent fullscreen data-testid="dialog-content">
          Content
        </dialog_1.DialogContent>
      </dialog_1.Dialog>);
        (0, vitest_1.expect)(react_1.screen.queryByRole("button", { name: /close/i })).not.toBeInTheDocument();
    });
    (0, vitest_1.it)("shows close button when mobileFullscreen is true", function () {
        (0, react_1.render)(<dialog_1.Dialog open>
        <dialog_1.DialogContent mobileFullscreen data-testid="dialog-content">
          Content
        </dialog_1.DialogContent>
      </dialog_1.Dialog>);
        (0, vitest_1.expect)(react_1.screen.getByRole("button", { name: /close/i })).toBeInTheDocument();
    });
    (0, vitest_1.it)("hides close button when hideCloseButton is true", function () {
        (0, react_1.render)(<dialog_1.Dialog open>
        <dialog_1.DialogContent hideCloseButton data-testid="dialog-content">
          Content
        </dialog_1.DialogContent>
      </dialog_1.Dialog>);
        (0, vitest_1.expect)(react_1.screen.queryByRole("button", { name: /close/i })).not.toBeInTheDocument();
    });
    (0, vitest_1.it)("merges custom className with default classes", function () {
        (0, react_1.render)(<dialog_1.Dialog open>
        <dialog_1.DialogContent className="custom-class" data-testid="dialog-content">
          Content
        </dialog_1.DialogContent>
      </dialog_1.Dialog>);
        var content = react_1.screen.getByTestId("dialog-content");
        (0, vitest_1.expect)(content).toHaveClass("custom-class");
        (0, vitest_1.expect)(content).toHaveClass("fixed");
        (0, vitest_1.expect)(content).toHaveClass("z-50");
    });
    (0, vitest_1.it)("renders children correctly", function () {
        (0, react_1.render)(<dialog_1.Dialog open>
        <dialog_1.DialogContent>
          <span>Test Child Content</span>
        </dialog_1.DialogContent>
      </dialog_1.Dialog>);
        (0, vitest_1.expect)(react_1.screen.getByText("Test Child Content")).toBeInTheDocument();
    });
});
