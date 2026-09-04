"use client";

/*
 * The chapter abstract and the per-section summaries below are chemistry
 * source material written in English. They are deliberately NOT in the message
 * catalogue — an unreviewed translation of chemistry is how a factual error
 * ships — so the literal-text lint rule is disabled for this file. Every piece
 * of interface chrome here (tab actions, the untranslated-content notice) does
 * come from the catalogue.
 */
/* eslint-disable react/jsx-no-literals */

import {
  ContentTab,
  type ContentTabItem,
} from "@/components/customs/content-tab";
import { useLocale, useTranslations } from "next-intl";
import { defaultLocale } from "@/i18n/routing";
import { getPathname, useRouter } from "@/i18n/navigation";

const STUDYING_CHEMISTRY_PATH =
  "/lessons/introduction-basics/studying-chemistry";

export default function ContentPage() {
  // Locale-aware router — `next/navigation` would drop the `/ar` prefix.
  const router = useRouter();
  const t = useTranslations("contentTab");
  const tTranslation = useTranslations("translation");
  const locale = useLocale();

  // The chapter text below is English-only source material; it is shown as-is
  // on other locales with a notice rather than machine-translated.
  const contentIsTranslated = locale === defaultLocale;

  const tabs: ContentTabItem[] = [
    {
      name: "1.1: Studying Chemistry",
      value: "studying-chemistry",
      actions: [
        {
          label: t("openInCurrentTab"),
          onClick: () => router.push(STUDYING_CHEMISTRY_PATH),
        },
        {
          label: t("openInNewTab"),
          onClick: () =>
            window.open(
              getPathname({ href: STUDYING_CHEMISTRY_PATH, locale }),
              "_blank",
            ),
        },
      ],
      content: (
        <>
          An understanding of chemistry is essential for understanding much of
          the natural world and is central to many other disciplines. Chemistry
          is the study of matter and the changes material substances undergo. It
          is essential for understanding much of the natural world and central
          to many other scientific disciplines, including astronomy, geology,
          paleontology, biology, and medicine.
        </>
      ),
    },
    {
      name: "1.2: Classification of Matter",
      value: "classification-of-matter",
      content: (
        <>
          Matter can be classified according to physical and chemical
          properties. Matter is anything that occupies space and has mass. The
          three states of matter are solid, liquid, and gas. A physical change
          involves the conversion of a substance from one state of matter to
          another, without changing its chemical composition. Most matter
          consists of mixtures of pure substances, which can be homogeneous
          (uniform in composition) or heterogeneous (different regions possess
          different compositions & properties).
        </>
      ),
    },
    {
      name: "1.3: Properties of Matter",
      value: "properties-of-matter",
      content: (
        <>
          All matter has physical and chemical properties. Physical properties
          are characteristics that scientists can measure without changing the
          composition of the sample under study, such as mass, color, and
          volume. Chemical properties describe the characteristic ability of a
          substance to react to form new substances; they include its
          flammability and susceptibility to corrosion.
        </>
      ),
    },
    {
      name: "1.4: Units of Measurement",
      value: "units-of-measurement",
      content: (
        <>
          The natural sciences begin with observation, and this usually involves
          numerical measurements of quantities such as length, volume, density,
          and temperature. Most of these quantities have units of some kind
          associated with them, and these units must be retained when you use
          them in calculations. Measuring units can be defined in terms of a
          very small number of fundamental ones that, through dimensional
          analysis, provide insight into their derivation and meaning.
        </>
      ),
    },
    {
      name: "1.5: Uncertainty in Measurement",
      value: "uncertainty-in-measurement",
      content: (
        <>
          Measurements may be accurate, meaning that the measured value is the
          same as the true value; they may be precise, meaning that multiple
          measurements give nearly identical values (i.e., reproducible
          results); they may be both accurate and precise; or they may be
          neither accurate nor precise. The goal of scientists is to obtain
          measured values that are both accurate and precise.
        </>
      ),
    },
    {
      name: "1.6: Dimensional Analysis",
      value: "dimensional-analysis",
      content: (
        <>
          Dimensional analysis is used in numerical calculations, and in
          converting units. It can help us identify whether an equation is set
          up correctly (i.e. the resulting units should be as expected). Units
          are treated similarly to the associated numerical values, i.e., if a
          variable in an equation is supposed to be squared, then the associated
          dimensions are squared, etc.
        </>
      ),
    },
  ];

  return (
    <div className="flex min-h-screen items-start justify-center px-6 py-12">
      <div className="w-full max-w-7xl space-y-8">
        {/* Chapter heading and abstract — chemistry source material, left in
            English on every locale (see the notice below). */}
        <div
          className="space-y-3"
          dir={contentIsTranslated ? undefined : "ltr"}
        >
          <h1 className="text-2xl font-semibold tracking-tight">
            1: Introduction — Matter and Measurement
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
            Chemistry is the study of matter and the changes that material
            substances undergo. Of all the scientific disciplines, it is perhaps
            the most extensively connected to other fields of study. A major
            goal of this text is to demonstrate the importance of chemistry in
            your daily life and in our collective understanding of both the
            physical world we occupy and the biological realm of which we are a
            part.
          </p>
        </div>

        {!contentIsTranslated && (
          <div
            className="rounded-lg border border-border bg-secondary px-4 py-3 text-sm"
            role="note"
          >
            <p className="font-semibold text-secondary-foreground">
              {tTranslation("notAvailableTitle")}
            </p>
            <p className="mt-0.5 text-muted-foreground">
              {tTranslation("notAvailableBody")}
            </p>
          </div>
        )}

        <ContentTab
          tabs={
            contentIsTranslated
              ? tabs
              : // Keep the English body text laid out left-to-right inside the
                // otherwise right-to-left page, so its punctuation and numbers
                // read correctly.
                tabs.map((tab) => ({
                  ...tab,
                  content: (
                    <div dir="ltr" className="text-start">
                      {tab.content}
                    </div>
                  ),
                }))
          }
          orientation="vertical"
        />
      </div>
    </div>
  );
}
