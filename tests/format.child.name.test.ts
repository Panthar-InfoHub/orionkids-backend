import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatChildName, formatChildFirstName } from "../src/lib/formatChildName.js";

describe("OrionKids — Consistent Child Name Capitalization Suite (Backend)", () => {
  it("Requirement 1: Lowercase single-word names start with capital letter", () => {
    assert.equal(formatChildName("ananya"), "Ananya");
    assert.equal(formatChildName("rahul"), "Rahul");
    assert.equal(formatChildName("tara"), "Tara");
    assert.equal(formatChildName("kabir"), "Kabir");
  });

  it("Requirement 2: Lowercase multi-word names capitalize every part", () => {
    assert.equal(formatChildName("riya sharma"), "Riya Sharma");
    assert.equal(formatChildName("dev sahu"), "Dev Sahu");
    assert.equal(formatChildName("arjun kumar verma"), "Arjun Kumar Verma");
  });

  it("Requirement 3: Already correctly capitalized names are preserved", () => {
    assert.equal(formatChildName("Ananya"), "Ananya");
    assert.equal(formatChildName("Riya Sharma"), "Riya Sharma");
    assert.equal(formatChildName("Dev Sahu"), "Dev Sahu");
  });

  it("Requirement 4: All-uppercase names are converted to professional title case", () => {
    assert.equal(formatChildName("ANANYA"), "Ananya");
    assert.equal(formatChildName("RIYA SHARMA"), "Riya Sharma");
    assert.equal(formatChildName("DEV SAHU"), "Dev Sahu");
  });

  it("Requirement 5: Leading and trailing spaces are trimmed", () => {
    assert.equal(formatChildName("  ananya  "), "Ananya");
    assert.equal(formatChildName("   rahul   "), "Rahul");
  });

  it("Requirement 6: Multiple consecutive spaces are normalized to a single space", () => {
    assert.equal(formatChildName("riya   sharma"), "Riya Sharma");
    assert.equal(formatChildName("  dev    sahu  "), "Dev Sahu");
    assert.equal(formatChildName("arjun   kumar   verma"), "Arjun Kumar Verma");
  });

  it("Requirement 7: Hyphenated names capitalize each hyphenated part", () => {
    assert.equal(formatChildName("mary-jane"), "Mary-Jane");
    assert.equal(formatChildName("MARY-JANE"), "Mary-Jane");
    assert.equal(formatChildName("jean-luc picard"), "Jean-Luc Picard");
  });

  it("Requirement 8: Apostrophe names capitalize following letter", () => {
    assert.equal(formatChildName("o'neil"), "O'Neil");
    assert.equal(formatChildName("O'NEIL"), "O'Neil");
    assert.equal(formatChildName("o’connor"), "O’Connor");
    assert.equal(formatChildName("d'angelo"), "D'Angelo");
  });

  it("Requirement 9: Null and undefined return safe empty string or fallback", () => {
    assert.equal(formatChildName(null), "");
    assert.equal(formatChildName(undefined), "");
    assert.equal(formatChildName(null, "Child"), "Child");
    assert.equal(formatChildName(undefined, "Your Child"), "Your Child");
    assert.equal(formatChildName(null, "your child"), "Your Child");
  });

  it("Requirement 10: Empty and whitespace-only strings return safe empty string or fallback", () => {
    assert.equal(formatChildName(""), "");
    assert.equal(formatChildName("   "), "");
    assert.equal(formatChildName("", "Child"), "Child");
    assert.equal(formatChildName("   ", "Your Child"), "Your Child");
  });

  it("Requirement 11: Unicode names are properly capitalized", () => {
    assert.equal(formatChildName("àlex"), "Àlex");
    assert.equal(formatChildName("élise"), "Élise");
    assert.equal(formatChildName("chloë"), "Chloë");
    assert.equal(formatChildName("ÀLEX"), "Àlex");
  });

  it("Requirement 12: formatChildFirstName extracts capitalized first word", () => {
    assert.equal(formatChildFirstName("riya sharma"), "Riya");
    assert.equal(formatChildFirstName("ananya"), "Ananya");
    assert.equal(formatChildFirstName("  dev  sahu  "), "Dev");
    assert.equal(formatChildFirstName("mary-jane watson"), "Mary-Jane");
    assert.equal(formatChildFirstName(null), "Child");
    assert.equal(formatChildFirstName(undefined, "Your Child"), "Your");
  });
});

