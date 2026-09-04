import { describe, expect, it } from "vitest";
import {
  assertDifficulty,
  richTextToText,
  textToRichText,
  toElementRow,
  toLessonRow,
  toLessonSectionRows,
  toQuestionRows,
  toQuizRow,
  type ElementJson,
  type QuizJson,
} from "@/db/seed/transform";
import elements from "@/data/periodic-table-detailed.json";
import lessons from "@/data/lessons.json";
import quizzes from "@/data/quiz.json";
import introduction from "@/data/lessons/introduction-basics.json";

/**
 * These run against the real seed input, so a bad row in `data/*.json` fails
 * here — fast, with no database — rather than halfway through a seed.
 */

describe("elements", () => {
  it("maps every element in the dataset without throwing", () => {
    const rows = (elements as unknown as ElementJson[]).map(toElementRow);
    expect(rows).toHaveLength(119);
  });

  it("maps snake_case JSON onto camelCase columns", () => {
    const [hydrogen] = elements as unknown as ElementJson[];
    const row = toElementRow(hydrogen);
    expect(row.symbol).toBe("H");
    expect(row.atomicMass).toBe(hydrogen.atomic_mass);
    expect(row.electronConfiguration).toBe(hydrogen.electron_configuration);
    expect(row.ionizationEnergies).toEqual(hydrogen.ionization_energies);
    expect(row.shells).toEqual(hydrogen.shells);
  });

  it("keeps nullable physics as null rather than inventing zeroes", () => {
    // A missing boiling point is unknown, not 0 K.
    const withNulls = (elements as unknown as ElementJson[]).find(
      (e) => e.boil === null,
    );
    expect(withNulls, "dataset should contain a null boil").toBeDefined();
    expect(toElementRow(withNulls!).boil).toBeNull();
  });

  it("rejects a nonsensical atomic number", () => {
    const bad = { ...(elements as unknown as ElementJson[])[0], number: 0 };
    expect(() => toElementRow(bad)).toThrow(/atomic number/);
  });

  it("rejects a non-positive shell count", () => {
    const bad = {
      ...(elements as unknown as ElementJson[])[0],
      shells: [1, 0],
    };
    expect(() => toElementRow(bad)).toThrow(/shells/);
  });
});

describe("lessons", () => {
  it("maps every lesson in the dataset", () => {
    const rows = (lessons as Parameters<typeof toLessonRow>[0][]).map(
      toLessonRow,
    );
    expect(rows).toHaveLength(13);
    expect(rows.every((r) => r.slug && r.title)).toBe(true);
  });

  it("defaults missing references to an empty array, not null", () => {
    const row = toLessonRow({
      slug: "x",
      title: "X",
      description: "d",
      difficulty: "easy",
      category: "c",
    });
    expect(row.references).toEqual([]);
  });

  it("rejects a difficulty outside the enum", () => {
    expect(() =>
      toLessonRow({
        slug: "x",
        title: "X",
        description: "d",
        difficulty: "impossible",
        category: "c",
      }),
    ).toThrow(/difficulty/);
  });
});

describe("rich text conversion", () => {
  it("wraps plain prose in a ProseMirror document", () => {
    const doc = textToRichText("Chemistry is the study of matter.");
    expect(doc.type).toBe("doc");
    expect(doc.content).toHaveLength(1);
  });

  it("splits on blank lines into separate paragraphs", () => {
    const doc = textToRichText("First para.\n\nSecond para.");
    expect(doc.content).toHaveLength(2);
  });

  it("round-trips the text verbatim", () => {
    // The migration must be lossless: existing lessons render identically.
    const original = "One.\n\nTwo.\n\nThree.";
    expect(richTextToText(textToRichText(original))).toBe(original);
  });

  it("round-trips every section of the real lesson body", () => {
    for (const section of introduction.sections) {
      const normalised = section.body
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter(Boolean)
        .join("\n\n");
      expect(richTextToText(textToRichText(section.body))).toBe(normalised);
    }
  });

  it("produces a valid document even for an empty body", () => {
    const doc = textToRichText("");
    expect(doc.type).toBe("doc");
    expect(doc.content).toHaveLength(1);
  });

  it("numbers sections from zero, in file order", () => {
    const rows = toLessonSectionRows(introduction.sections);
    expect(rows.map((r) => r.position)).toEqual(
      introduction.sections.map((_, i) => i),
    );
    expect(rows[0].heading).toBe(introduction.sections[0].heading);
  });
});

describe("quizzes", () => {
  const data = quizzes as unknown as QuizJson[];

  it("maps every quiz", () => {
    expect(data.map(toQuizRow)).toHaveLength(6);
  });

  it("resolves every answer to an option position across the whole dataset", () => {
    // The point of the migration: the answer stops being a copy of an option's
    // text and becomes a reference to it.
    let questions = 0;
    for (const quiz of data) {
      for (const question of toQuestionRows(quiz)) {
        questions += 1;
        const correct = question.options[question.correctOptionPosition];
        expect(correct).toBeDefined();
        const source = quiz.questions[question.position];
        expect(correct.label).toBe(source.answer);
      }
    }
    expect(questions).toBe(60);
  });

  it("preserves option order", () => {
    const [quiz] = data;
    const [question] = toQuestionRows(quiz);
    expect(question.options.map((o) => o.label)).toEqual(
      quiz.questions[0].options,
    );
  });

  it("fails loudly when the answer matches no option", () => {
    const broken: QuizJson = {
      ...data[0],
      questions: [{ ...data[0].questions[0], answer: "not an option" }],
    };
    expect(() => toQuestionRows(broken)).toThrow(/not one of its options/);
  });

  it("fails loudly on duplicate options, which make the answer ambiguous", () => {
    const broken: QuizJson = {
      ...data[0],
      questions: [
        { ...data[0].questions[0], options: ["A", "A", "B"], answer: "A" },
      ],
    };
    expect(() => toQuestionRows(broken)).toThrow(/duplicate options/);
  });
});

describe("assertDifficulty", () => {
  it.each(["easy", "medium", "hard"])("accepts %s", (value) => {
    expect(assertDifficulty(value, "ctx")).toBe(value);
  });

  it("names the offending context in its error", () => {
    expect(() => assertDifficulty("nope", 'quiz "acids"')).toThrow(
      /quiz "acids"/,
    );
  });
});
