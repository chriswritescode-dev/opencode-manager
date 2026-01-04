import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageHeader } from "./page-header";

describe("PageHeader", () => {
  it("applies pt-safe class for iOS safe area", () => {
    render(<PageHeader data-testid="header">Content</PageHeader>);
    const header = screen.getByTestId("header");
    expect(header).toHaveClass("pt-safe");
  });

  it("applies sticky top-0 positioning", () => {
    render(<PageHeader data-testid="header">Content</PageHeader>);
    const header = screen.getByTestId("header");
    expect(header).toHaveClass("sticky");
    expect(header).toHaveClass("top-0");
  });

  it("renders children correctly", () => {
    render(
      <PageHeader>
        <span>Test Child</span>
      </PageHeader>
    );
    expect(screen.getByText("Test Child")).toBeInTheDocument();
  });

  it("merges custom className", () => {
    render(
      <PageHeader data-testid="header" className="custom-class">
        Content
      </PageHeader>
    );
    const header = screen.getByTestId("header");
    expect(header).toHaveClass("custom-class");
    expect(header).toHaveClass("pt-safe");
  });

  it("forwards additional props", () => {
    render(
      <PageHeader data-testid="header" aria-label="Page header">
        Content
      </PageHeader>
    );
    const header = screen.getByTestId("header");
    expect(header).toHaveAttribute("aria-label", "Page header");
  });

  it("applies z-10 for proper stacking", () => {
    render(<PageHeader data-testid="header">Content</PageHeader>);
    const header = screen.getByTestId("header");
    expect(header).toHaveClass("z-10");
  });

  it("applies background and border styling", () => {
    render(<PageHeader data-testid="header">Content</PageHeader>);
    const header = screen.getByTestId("header");
    expect(header).toHaveClass("border-b");
    expect(header).toHaveClass("border-border");
    expect(header).toHaveClass("bg-gradient-to-b");
  });

  it("applies backdrop-blur-sm for frosted glass effect", () => {
    render(<PageHeader data-testid="header">Content</PageHeader>);
    const header = screen.getByTestId("header");
    expect(header).toHaveClass("backdrop-blur-sm");
  });
});
