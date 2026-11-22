import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { MAX_IMPORT_ROWS } from '../../shared/parseImport'
import { GRADE_LABELS } from '../../shared/srs'
import { LEARN_GROUP_SIZE, LEARN_MORE_STEP } from '../lib/learnSession'
import { card, muted, Screen } from '../components/ui'

/** A plain-language guide to the app. Button names in quotes match the real UI labels. */
export function HowTo() {
  return (
    <Screen
      title="How to use the app"
      action={
        <Link to="/" className="-mr-2 inline-flex min-h-11 items-center px-2 text-sm font-medium text-zinc-500 underline dark:text-zinc-400">
          Home
        </Link>
      }
    >
      <p className="text-sm">
        Flashcards helps you learn vocabulary in another language, a few words at a time. You add words, the app prepares a translation
        and an example sentence for each one, and then it shows you each word again just before you're likely to forget it.
      </p>

      <Section title="Decks">
        <p>
          A deck holds the words you're learning in one language. To make one, tap <B>Create a deck</B> (or <B>New deck</B> in Settings),
          give it a name and choose <B>I speak</B> and <B>I'm learning</B>. The language pair can't be changed later, so make a new deck
          for another language.
        </p>
        <p>If you have more than one deck, switch between them with the menu at the top of Home. Decks can be deleted in Settings.</p>
      </Section>

      <Section title="Adding words">
        <p>
          Tap <B>Add words</B>. There are two tabs:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <B>Add new words</B> adds the most common words of the language that you don't have yet. Choose how many (5, 10, 20 or
            Custom) and tap <B>Add 10 words</B>. If you already know the basics, set “Skip the N most common words” in Settings.
          </li>
          <li>
            <B>Import</B> takes your own list. Type or paste one word per line, or tap <B>Choose file…</B> to load a .txt, .csv or .tsv
            file. You can add a meaning after a tab, “;” or “|” (for example <span className="font-mono">Hund;dog</span>). Lines starting
            with # are ignored. Under “The words are in”, say which language your list is in, or pick Auto. You'll see a preview first;
            up to {MAX_IMPORT_ROWS} words at a time.
          </li>
        </ul>
        <p>
          The translation, example sentence and other details are filled in by AI, which can take a moment. While that happens a word
          shows as “Preparing…”. Words you already have are not added twice: they're listed as “already in your deck”. AI can make
          mistakes, so you can correct any word later.
        </p>
        <p className="font-medium">What the word states mean</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <B>Preparing</B>: the AI is still working on it.
          </li>
          <li>
            <B>Ready</B>: it can be learned and reviewed.
          </li>
          <li>
            <B>Failed</B>: it couldn't be prepared (for example, it wasn't recognised as a word). Tap <B>Retry failed</B> to try again.
          </li>
          <li>
            <B>Duplicates</B>: it turned out to be a word you already had, so it isn't studied twice.
          </li>
        </ul>
      </Section>

      <Section title="Learn new words">
        <p>
          Tap <B>Learn new</B> on Home. New words come in groups of {LEARN_GROUP_SIZE}. First you see each word with its translation and
          example; tap <B>Got it</B>, or <B>I already know this</B> to skip it. Then a <B>Quick check</B> tests the group: try to
          remember the answer, tap <B>Show answer</B> and grade yourself.
        </p>
        <p>
          There's a daily limit for new words so reviews don't pile up. When you reach it, Home says <B>Daily limit reached</B>; you can
          still tap <B>Learn {LEARN_MORE_STEP} more</B> if you want to.
        </p>
      </Section>

      <Section title="Train">
        <p>
          Tap <B>Train</B> on Home to review the words that are due. Look at the card, try to remember the answer, then tap the card or{' '}
          <B>Show answer</B>. Then tell the app how it went:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <B>{GRADE_LABELS[1]}</B>: you didn't know it. It comes back in a few minutes.
          </li>
          <li>
            <B>{GRADE_LABELS[2]}</B>: you got it, but with effort. It comes back a little sooner.
          </li>
          <li>
            <B>{GRADE_LABELS[3]}</B>: you knew it. This is the usual answer.
          </li>
          <li>
            <B>{GRADE_LABELS[4]}</B>: you knew it instantly. It waits longer before coming back.
          </li>
        </ul>
        <p>Each button shows when you'll see the word again. Be honest: it keeps your reviews well timed.</p>
        <p>
          The switch at the top sets the direction: the language you're learning first, your own language first, or Mixed. On the
          back of a card, <B>Listen</B> reads the word and sentence aloud. When nothing is due you'll see <B>All done</B>, and{' '}
          <B>Practice anyway</B> lets you review early.
        </p>
        <p className={muted}>With a keyboard: Space shows the answer, and 1 to 4 pick {Object.values(GRADE_LABELS).join(', ')}.</p>
      </Section>

      <Section title="How reviews are scheduled">
        <p>
          The app uses spaced repetition: every time you remember a word, the gap before its next review grows, from minutes to days to
          months. Words you forget come back sooner, so your time goes to the words you find hard.
        </p>
      </Section>

      <Section title="Your words">
        <p>
          The <B>Words</B> tab lists everything in the deck. Search, or filter by All, Preparing, Ready, Failed, Suspended or Duplicates.
          Tap a word to open its page.
        </p>
        <p>On a word's page you can:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <B>Edit</B> the translation, extra meanings (“Also means”), the example sentence and its translation, and a note. In a
            sentence, wrap the word in double brackets, like <span className="font-mono">Der [[Hund]] bellt.</span>, to highlight it.
            Leave a field empty to go back to the generated text.
          </li>
          <li>
            <B>Suspend</B> a word to stop it appearing in Learn and Train, and <B>Unsuspend</B> it to bring it back.
          </li>
          <li>
            <B>Retry failed words</B> if it couldn't be prepared, or <B>Delete</B> it.
          </li>
        </ul>
      </Section>

      <Section title="Settings">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <B>Read words aloud</B>: speaks the word automatically when a new word is introduced and when you reveal an answer.
          </li>
          <li>
            <B>Hide the sentence on the front</B>: shows only the word until you reveal the answer, which makes it harder.
          </li>
          <li>
            <B>Skip the N most common words</B>: where “Add new words” starts in the frequency list, for this deck.
          </li>
          <li>Create and delete decks, and see the word list credits under About.</li>
        </ul>
      </Section>

      <Section title="Weak connection">
        <p>
          If your connection drops in the middle of Learn or Train, keep going: your answers are saved on your phone and sent
          automatically when you're back online. You need a connection to open the app and to add words.
        </p>
      </Section>

      <Section title="Add it to your home screen">
        <p>Install the app to open it like any other app, full screen.</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <B>iPhone (Safari)</B>: tap Share, then <B>Add to Home Screen</B>.
          </li>
          <li>
            <B>Android (Chrome)</B>: tap the ⋮ menu, then <B>Install app</B> or <B>Add to Home screen</B>.
          </li>
        </ul>
      </Section>

      <Section title="Tips">
        <ul className="list-disc space-y-1 pl-5">
          <li>Study a little every day. Ten minutes daily beats an hour once a week.</li>
          <li>Do your Train reviews before learning new words.</li>
          <li>Say the word out loud, or tap Listen, to remember the sound too.</li>
          <li>Add words you actually meet, in books, shows or conversations.</li>
          <li>If a translation or sentence looks wrong, fix it with Edit.</li>
        </ul>
      </Section>
    </Screen>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={`${card} flex flex-col gap-2 text-sm leading-relaxed`}>
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  )
}

function B({ children }: { children: ReactNode }) {
  return <strong className="font-semibold">{children}</strong>
}
