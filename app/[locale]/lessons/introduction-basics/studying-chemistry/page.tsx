import React from "react";
import ArticleLayout from "@/components/customs/article-layout";

export default function StudyingChemistry() {
  return (
    <ArticleLayout
      title="Studying Chemistry"
      description="Chemistry is the study of matter and the changes that material substances undergo — perhaps the most extensively connected of all scientific disciplines."
      author={{ name: "Brown et al.", role: "General Chemistry" }}
      date="2024-01-15"
      tags={["Chemistry", "Introduction", "Science"]}
      heroImage={{
        src: "https://imgs.search.brave.com/T_eMbElJjvv4SZ4Ejib_-RdQgxsijhudMA9T2I0qFLQ/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly9jaGVt/aWNhbHNvbHV0aW9u/cy5pbi93cC1jb250/ZW50L3VwbG9hZHMv/MjAyNC8wMi9jaGVt/aWNhbC1ibG9nLTIu/cG5n",
        alt: "Colorful chemical solutions in laboratory flasks",
        caption:
          " Chemistry in Everyday Life. Although most people do not recognize it, chemistry and chemical compounds are crucial ingredients in almost everything we eat, wear, and use",
      }}
      sections={[
        {
          id: "what-is-chemistry",
          heading: "What Is Chemistry?",
          content: (
            <p>
              Chemistry is the study of matter and the changes that material
              substances undergo. Of all the scientific disciplines, it is
              perhaps the most extensively connected to other fields of study.
              Geologists who want to locate new mineral or oil deposits use
              chemical techniques to analyze and identify rock samples.
              Oceanographers use chemistry to track ocean currents, determine
              the flux of nutrients into the sea, and measure the rate of
              exchange of nutrients between ocean layers. Engineers consider the
              relationships between the structures and the properties of
              substances when they specify materials for various uses.
              Physicists take advantage of the properties of substances to
              detect new subatomic particles. Astronomers use chemical
              signatures to determine the age and distance of stars and thus
              answer questions about how stars form and how old the universe is.
              The entire subject of environmental science depends on chemistry
              to explain the origin and impacts of phenomena such as air
              pollution, ozone layer depletion, and global warming.
            </p>
          ),
          callout: {
            type: "note",
            text: "Chemistry connects every scientific discipline — from geology and oceanography to medicine and forensics.",
          },
        },
        {
          id: "chemistry-and-life",
          heading: "Chemistry and Living Systems",
          content: (
            <>
              <p>
                The entire subject of environmental science depends on chemistry
                to explain the origin and impacts of phenomena such as air
                pollution, ozone layer depletion, and global warming. The
                disciplines that focus on living organisms and their
                interactions with the physical world rely heavily on
                biochemistry, the application of chemistry to the study of
                biological processes.
              </p>
              <p className="mt-4">
                A living cell contains a large collection of complex molecules
                that carry out thousands of chemical reactions, including those
                that are necessary for the cell to reproduce. Biological
                phenomena such as vision, taste, smell, and movement result from
                numerous chemical reactions.
              </p>
            </>
          ),
        },
        {
          id: "practical-applications",
          heading: "Practical Applications",
          content: (
            <p>
              Engineers need to understand the chemical properties of the
              substances when designing biologically compatible implants for
              joint replacements or designing roads, bridges, buildings, and
              nuclear reactors that do not collapse because of weakened
              structural materials such as steel and cement. Archaeology and
              paleontology rely on chemical techniques to date bones and
              artifacts and identify their origins.
            </p>
          ),
          callout: {
            type: "tip",
            text: "DNA matching — comparing biological samples of genetic material — has been used to solve many high-profile criminal cases and exonerate innocent people.",
          },
          image: {
            src: "https://imgs.search.brave.com/4RfcJ-0wUheB58lzC9NDtZutnTyzKlrH306fAy-IBcc/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly90NC5m/dGNkbi5uZXQvanBn/LzE4LzYwLzk5LzM1/LzM2MF9GXzE4NjA5/OTM1NzBfRmVzOVVn/QkdlMGFCSGlIUnMw/Rkp2T2VmMXJhcnJi/QWouanBn",
            alt: "DNA double helix structure",
            caption:
              "Figure 1.2 — The DNA double helix, central to forensic chemistry.",
          },
        },
        {
          id: "chemistry-and-society",
          heading: "Chemistry and Society",
          content: (
            <p>
              Although law is not normally considered a field related to
              chemistry, forensic scientists use chemical methods to analyze
              blood, fibers, and other evidence as they investigate crimes.
              Forensics is a rapidly growing area of applied chemistry. In
              addition, the proliferation of chemical and biochemical
              innovations in industry is producing rapid growth in the area of
              patent law. Ultimately, the dispersal of information in all the
              fields in which chemistry plays a part requires experts who are
              able to explain complex chemical issues to the public.
            </p>
          ),
        },
      ]}
      videos={[
        {
          embedUrl: "https://www.youtube.com/embed/bka20Q9TN6M",
          title: "Introduction to Chemistry",
          caption: "A brief introduction to the world of chemistry.",
        },
      ]}
      links={[
        {
          label: "LibreTexts: Chemistry — The Central Science",
          href: "https://chem.libretexts.org/Bookshelves/General_Chemistry/Map%3A_Chemistry_-_The_Central_Science_(Brown_et_al.)",
          description: "Full textbook on LibreTexts open-access platform.",
        },
        {
          label: "Khan Academy — Chemistry",
          href: "https://www.khanacademy.org/science/chemistry",
          description:
            "Free video lessons covering all major chemistry topics.",
        },
      ]}
    />
  );
}
