import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button, buttonVariants } from "@/components/ui/button";

describe("Button", () => {
  it("renders its children as a button element", () => {
    render(<Button>Start quiz</Button>);
    const button = screen.getByRole("button", { name: "Start quiz" });
    expect(button).toBeInTheDocument();
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("data-slot", "button");
  });

  it("calls onClick when clicked", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Next</Button>);

    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not fire onClick while disabled", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Next
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Next" });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("applies variant and size classes and merges a custom className", () => {
    render(
      <Button variant="destructive" size="lg" className="w-full">
        Reset
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Reset" });
    expect(button).toHaveClass("bg-destructive", "h-10", "w-full");
  });

  it("renders as a child element with asChild", () => {
    render(
      <Button asChild>
        <a href="#quiz-list">Browse quizzes</a>
      </Button>,
    );

    const link = screen.getByRole("link", { name: "Browse quizzes" });
    expect(link).toHaveAttribute("href", "#quiz-list");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("buttonVariants", () => {
  it("falls back to the default variant and size", () => {
    expect(buttonVariants()).toContain("bg-primary");
    expect(buttonVariants()).toContain("h-9");
  });

  it("produces distinct classes per variant", () => {
    expect(buttonVariants({ variant: "outline" })).not.toBe(
      buttonVariants({ variant: "ghost" }),
    );
  });
});
