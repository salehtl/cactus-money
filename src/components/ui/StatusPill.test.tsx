import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StatusPill } from "../ui/StatusPill";

describe("StatusPill", () => {
  it("renders planned status text", () => {
    render(<StatusPill status="planned" onClick={() => {}} />);
    expect(screen.getByText("Plan")).toBeInTheDocument();
    expect(screen.getByTitle("Mark as confirmed")).toBeInTheDocument();
  });

  it("renders confirmed status text", () => {
    render(<StatusPill status="confirmed" onClick={() => {}} />);
    expect(screen.getByText("Conf")).toBeInTheDocument();
    expect(screen.getByTitle("Mark as planned")).toBeInTheDocument();
  });

  it("calls onClick when clicked", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<StatusPill status="planned" onClick={onClick} />);

    await user.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("does not call onClick when disabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<StatusPill status="planned" onClick={onClick} disabled />);

    await user.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });
});
