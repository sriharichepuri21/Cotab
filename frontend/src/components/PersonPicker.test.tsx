import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const checkNumber = vi.fn();
vi.mock("@/lib/api", () => ({ checkNumber: (...a: unknown[]) => checkNumber(...a) }));

const PEOPLE = [
  {
    ref: "r-carter",
    account: "a-carter",
    name: "Ben",
    phone: null,
    hint: "•••0199",
    on_cotab: true,
    tabs: 3,
  },
  {
    ref: "r-lee",
    account: "a-lee",
    name: "Ben",
    phone: "+16465550177",
    hint: null,
    on_cotab: true,
    tabs: 1,
  },
];
vi.mock("@/lib/data", () => ({ usePeople: () => ({ data: PEOPLE }) }));

import { PersonPicker, kindOf, type InSplit } from "./PersonPicker";

const FIELD = "Their mobile number, email or name";
const onCotab = (over = {}) => ({
  phone: "+14155550199",
  email: null,
  you: false,
  on_cotab: true,
  name: "Ben Carter",
  account: "a-carter",
  ...over,
});
const nobody = (over = {}) => ({
  phone: "+19175550123",
  email: null,
  you: false,
  on_cotab: false,
  name: null,
  account: null,
  ...over,
});

function show(existing: InSplit[] = [], onAdd = vi.fn(), onRename?: () => void) {
  render(<PersonPicker existing={existing} onAdd={onAdd} onRename={onRename} />);
  return onAdd;
}
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const addButton = () => screen.getByRole("button", { name: "Add" }) as HTMLButtonElement;

beforeEach(() => {
  checkNumber.mockReset();
});
afterEach(cleanup);

describe("PersonPicker", () => {
  it("tells numbers, emails and names apart", () => {
    expect(kindOf("415 555")).toBe("phone");
    expect(kindOf("(415) 555-0199")).toBe("phone");
    expect(kindOf("ben@x")).toBe("email");
    expect(kindOf("Ben")).toBe("name");
    expect(kindOf("41")).toBe("name");
  });

  it("finds who signed up with a number, under their own name", async () => {
    checkNumber.mockResolvedValue(onCotab());
    const onAdd = show();
    type(FIELD, "4155550199");
    expect((screen.getByLabelText(FIELD) as HTMLInputElement).value).toBe("(415) 555-0199");
    expect(await screen.findByText("Ben Carter")).toBeTruthy();
    expect(screen.getByText(/On Cotab. They'll be added right away/)).toBeTruthy();
    expect(checkNumber).toHaveBeenCalledWith("(415) 555-0199");
    fireEvent.click(addButton());
    await waitFor(() =>
      expect(onAdd).toHaveBeenCalledWith({ name: "Ben Carter", phone: "(415) 555-0199" })
    );
  });

  it("finds who signed up with an email", async () => {
    checkNumber.mockResolvedValue(onCotab({ phone: null, email: "ben@x.com" }));
    const onAdd = show();
    type(FIELD, "ben@x.com");
    await screen.findByText("Ben Carter");
    fireEvent.click(addButton());
    await waitFor(() =>
      expect(onAdd).toHaveBeenCalledWith({ name: "Ben Carter", email: "ben@x.com" })
    );
  });

  it("nobody with that number: name them, then add and invite", async () => {
    checkNumber.mockResolvedValue(nobody());
    const onAdd = show();
    type(FIELD, "9175550123");
    expect((await screen.findByRole("status")).textContent).toBe(
      "No one on Cotab with this number yet. Add them, then send them the invite link to sign up."
    );
    expect(addButton().disabled).toBe(true);
    type("What to call them", "Dev");
    fireEvent.click(addButton());
    await waitFor(() =>
      expect(onAdd).toHaveBeenCalledWith({ name: "Dev", phone: "(917) 555-0123" })
    );
  });

  it("waits for a whole number before looking it up", () => {
    show();
    type(FIELD, "415555");
    expect(screen.getByText("Keep typing their number…")).toBeTruthy();
    expect(checkNumber).not.toHaveBeenCalled();
    expect(addButton().disabled).toBe(true);
  });

  it("someone already in the split, by account, can't be added again", async () => {
    checkNumber.mockResolvedValue(onCotab());
    show([{ name: "Ben", account: "a-carter" }]);
    type(FIELD, "4155550199");
    expect((await screen.findByRole("alert")).textContent).toBe("Ben is already in this split.");
    expect(addButton().disabled).toBe(true);
  });

  it("a number already in the split, under any name, can't be added again", async () => {
    checkNumber.mockResolvedValue(nobody());
    show([{ name: "Dev", phone: "+19175550123" }]);
    type(FIELD, "917 555 0123");
    expect((await screen.findByRole("alert")).textContent).toBe("Dev is already in this split.");
  });

  it("says when it's your own number", async () => {
    checkNumber.mockResolvedValue(onCotab({ you: true, name: null, account: null }));
    show();
    type(FIELD, "4155550199");
    expect((await screen.findByRole("alert")).textContent).toBe("That's your own number.");
  });

  it("typing a name searches the people on Cotab you've split with", () => {
    show([{ name: "Ben", account: "a-carter" }]);
    type(FIELD, "be");
    const [carter, lee] = screen.getAllByRole("option");
    expect(carter.textContent).toContain("Already in this split");
    expect(carter.getAttribute("aria-disabled")).toBe("true");
    expect(lee.textContent).toBe("Ben(646) 555-0177On Cotab");
  });

  it("adds the exact person picked from your people", async () => {
    const onAdd = show();
    type(FIELD, "Ben");
    fireEvent.click(screen.getAllByRole("option")[1]);
    expect(screen.getByText("(646) 555-0177. On Cotab")).toBeTruthy();
    fireEvent.click(addButton());
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith({ name: "Ben", from_member: "r-lee" }));
  });

  it("a name nobody you know has: type their number or email instead", () => {
    show();
    type(FIELD, "Dev");
    expect(
      screen.getByText(
        "No one called Dev among your people on Cotab. Type their mobile number or email to find them."
      )
    ).toBeTruthy();
    expect(addButton().disabled).toBe(true);
  });

  it("a different person with a name already here asks for two names", async () => {
    checkNumber.mockResolvedValue(onCotab({ name: "Ben", account: "a-lee" }));
    const onAdd = vi.fn();
    const onRename = vi.fn();
    const here = { name: "Ben", phone: "+14155550100", ref: "m-1" };
    show([here], onAdd, onRename);
    type(FIELD, "6465550177");
    await screen.findByText(/They'll be added right away/);
    fireEvent.click(addButton());

    const dialog = screen.getByRole("dialog", { name: "There's already a Ben in this split" });
    expect(dialog.textContent).toContain("Ben ((415) 555-0100) is a different person");
    const add = () => within(dialog).getByRole("button", { name: "Add" }) as HTMLButtonElement;
    expect(add().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("New name for the Ben you're adding"), {
      target: { value: "Ben Lee" },
    });
    fireEvent.change(screen.getByLabelText("Name for the Ben already in this split"), {
      target: { value: "Ben Carter" },
    });
    fireEvent.click(add());
    await waitFor(() =>
      expect(onAdd).toHaveBeenCalledWith({ name: "Ben Lee", phone: "(646) 555-0177" })
    );
    expect(onRename).toHaveBeenCalledWith(here, "Ben Carter");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows why the server refused, and keeps what was typed", async () => {
    checkNumber.mockResolvedValue(onCotab());
    show(
      [],
      vi.fn(async () => {
        throw new Error("That number is already in this split, as Ben.");
      })
    );
    type(FIELD, "4155550199");
    await screen.findByText("Ben Carter");
    fireEvent.click(addButton());
    expect((await screen.findByRole("alert")).textContent).toBe(
      "That number is already in this split, as Ben."
    );
    expect((screen.getByLabelText(FIELD) as HTMLInputElement).value).toBe("(415) 555-0199");
  });
});
