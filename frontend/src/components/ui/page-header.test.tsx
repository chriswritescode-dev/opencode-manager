import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageHeader } from "./page-header";

describe("PageHeader", () => {
  it("renders children correctly", () => {
    render(
      <PageHeader>
        <span>Test Child</span>
      </PageHeader>
    );
    expect(screen.getByText("Test Child")).toBeInTheDocument();
  });
});
