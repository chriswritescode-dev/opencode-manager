"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var vitest_1 = require("vitest");
var react_1 = require("@testing-library/react");
var page_header_1 = require("./page-header");
(0, vitest_1.describe)("PageHeader", function () {
    (0, vitest_1.it)("applies pt-safe class for iOS safe area", function () {
        (0, react_1.render)(<page_header_1.PageHeader data-testid="header">Content</page_header_1.PageHeader>);
        var header = react_1.screen.getByTestId("header");
        (0, vitest_1.expect)(header).toHaveClass("pt-safe");
    });
    (0, vitest_1.it)("applies sticky top-0 positioning", function () {
        (0, react_1.render)(<page_header_1.PageHeader data-testid="header">Content</page_header_1.PageHeader>);
        var header = react_1.screen.getByTestId("header");
        (0, vitest_1.expect)(header).toHaveClass("sticky");
        (0, vitest_1.expect)(header).toHaveClass("top-0");
    });
    (0, vitest_1.it)("renders children correctly", function () {
        (0, react_1.render)(<page_header_1.PageHeader>
        <span>Test Child</span>
      </page_header_1.PageHeader>);
        (0, vitest_1.expect)(react_1.screen.getByText("Test Child")).toBeInTheDocument();
    });
    (0, vitest_1.it)("merges custom className", function () {
        (0, react_1.render)(<page_header_1.PageHeader data-testid="header" className="custom-class">
        Content
      </page_header_1.PageHeader>);
        var header = react_1.screen.getByTestId("header");
        (0, vitest_1.expect)(header).toHaveClass("custom-class");
        (0, vitest_1.expect)(header).toHaveClass("pt-safe");
    });
    (0, vitest_1.it)("forwards additional props", function () {
        (0, react_1.render)(<page_header_1.PageHeader data-testid="header" aria-label="Page header">
        Content
      </page_header_1.PageHeader>);
        var header = react_1.screen.getByTestId("header");
        (0, vitest_1.expect)(header).toHaveAttribute("aria-label", "Page header");
    });
    (0, vitest_1.it)("applies z-10 for proper stacking", function () {
        (0, react_1.render)(<page_header_1.PageHeader data-testid="header">Content</page_header_1.PageHeader>);
        var header = react_1.screen.getByTestId("header");
        (0, vitest_1.expect)(header).toHaveClass("z-10");
    });
    (0, vitest_1.it)("applies background and border styling", function () {
        (0, react_1.render)(<page_header_1.PageHeader data-testid="header">Content</page_header_1.PageHeader>);
        var header = react_1.screen.getByTestId("header");
        (0, vitest_1.expect)(header).toHaveClass("border-b");
        (0, vitest_1.expect)(header).toHaveClass("border-border");
        (0, vitest_1.expect)(header).toHaveClass("bg-gradient-to-b");
    });
    (0, vitest_1.it)("applies backdrop-blur-sm for frosted glass effect", function () {
        (0, react_1.render)(<page_header_1.PageHeader data-testid="header">Content</page_header_1.PageHeader>);
        var header = react_1.screen.getByTestId("header");
        (0, vitest_1.expect)(header).toHaveClass("backdrop-blur-sm");
    });
});
