/app
├─ layout.tsx # Main layout (Header, Footer, theme)
├─ page.tsx # Home page (intro + lesson links)
├─ lessons/
│ ├─ page.tsx # Lessons overview (grid of lessons)
│ ├─ atoms/page.tsx
│ ├─ molecules/page.tsx
│ ├─ reactions/page.tsx
│ ├─ periodic-table/page.tsx
│ └─ elements/
│ └─ [symbol]/page.tsx # Dynamic element page, e.g., /elements/O
├─ quiz/
│ ├─ page.tsx # Quiz overview / topic select
│ ├─ random/page.tsx # Random quiz page
│ └─ results/page.tsx # Quiz results
├─ experiments/
│ ├─ page.tsx # Experiments overview
│ ├─ experiment1/page.tsx
│ └─ experiment2/page.tsx
├─ games/
│ ├─ page.tsx
│ ├─ molecule-builder/page.tsx
│ └─ atom-matching/page.tsx
├─ about/page.tsx
├─ contact/page.tsx
├─ api/
│ └─ quiz/route.ts # API route returning random quiz JSON
└─ components/
├─ Header.tsx
├─ Footer.tsx
├─ LessonCard.tsx
├─ QuizCard.tsx
├─ AtomVisualizer.tsx
├─ MoleculeBuilder.tsx
└─ PeriodicTable.tsx
