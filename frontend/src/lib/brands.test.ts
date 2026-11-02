import { describe, expect, it } from "vitest";

import { brandLogo, shopName } from "./brands";

describe("brandLogo", () => {
  it("reads merchant names the way receipts print them", () => {
    expect(brandLogo("COSTCO WHSE #0482")).toBe("/brands/costco.svg");
    expect(brandLogo("Costco Wholesale")).toBe("/brands/costco.svg");
    expect(brandLogo("WAL-MART SUPERCENTER 1234")).toBe("/brands/walmart.svg");
    expect(brandLogo("WM SUPERCENTER")).toBe("/brands/walmart.svg");
    expect(brandLogo("TRADER JOE'S #552")).toBe("/brands/trader-joes.svg");
    expect(brandLogo("McDonald's F1234")).toBe("/brands/mcdonalds.svg");
    expect(brandLogo("7-ELEVEN 3321")).toBe("/brands/seven-eleven.svg");
    expect(brandLogo("CVS/PHARMACY #0123")).toBe("/brands/cvs.svg");
    expect(brandLogo("H&M")).toBe("/brands/hm.svg");
    expect(brandLogo("AT&T Store")).toBe("/brands/att.svg");
    expect(brandLogo("TARGET T-1234")).toBe("/brands/target.svg");
    expect(brandLogo("Uber Eats")).toBe("/brands/uber.svg");
    expect(brandLogo("Whole Foods")).toBe("/brands/whole-foods.svg");
  });

  it("keeps the category icon rather than guess", () => {
    for (const name of [
      "American Eagle Outfitters",
      "Delta Dental",
      "United Way",
      "Target Range Supplies",
      "Shell Beach Cafe",
      "Apple Valley Farm",
      "Applebee's",
      "Zara's Kitchen",
      "Southwest Plumbing",
      "Blue Bottle",
      "Nopa",
      "Receipt",
      "",
    ]) {
      expect(brandLogo(name)).toBeNull();
    }
    expect(brandLogo(null)).toBeNull();
  });
});

describe("shopName", () => {
  it("turns scanned shorthand into the shop's proper name", () => {
    expect(shopName("COSTCO WHSE #0482")).toBe("Costco");
    expect(shopName("WAL-MART SUPERCENTER 1234")).toBe("Walmart");
    expect(shopName("TRADER JOE'S #552")).toBe("Trader Joe's");
    expect(shopName("MCDONALD'S F1234")).toBe("McDonald's");
    expect(shopName("CVS/PHARMACY #0123")).toBe("CVS");
    expect(shopName("7-ELEVEN 3321")).toBe("7-Eleven");
    expect(shopName("H&M")).toBe("H&M");
    expect(shopName("DD *DOORDASH")).toBe("DoorDash");
    expect(shopName("AMZN MKTP")).toBe("Amazon Marketplace");
  });

  it("tidies shops it doesn't know", () => {
    expect(shopName("JOE'S PIZZA #12")).toBe("Joe's Pizza");
    expect(shopName("TST* BLUE DOOR CAFE")).toBe("Blue Door Cafe");
    expect(shopName("O'BRIEN'S PUB")).toBe("O'Brien's Pub");
    expect(shopName("HOUSE OF BBQ INC")).toBe("House of BBQ");
    expect(shopName("ACME HARDWARE WHSE STORE 88")).toBe("Acme Hardware Warehouse");
    expect(shopName("costa coffee")).toBe("Costa Coffee");
  });

  it("leaves names people typed alone", () => {
    expect(shopName("Costco Gas")).toBe("Costco Gas");
    expect(shopName("Nopa")).toBe("Nopa");
    expect(shopName("Blue Bottle")).toBe("Blue Bottle");
    expect(shopName("Dad's birthday dinner")).toBe("Dad's birthday dinner");
  });

  it("never loses the name", () => {
    expect(shopName("#0482")).toBe("#0482");
    expect(shopName("")).toBe("");
    expect(shopName(null)).toBe("");
  });
});
