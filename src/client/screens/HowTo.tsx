import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { MAX_IMPORT_ROWS } from '../../shared/parseImport'
import { GRADE_LABELS } from '../../shared/srs'
import { LEARN_GROUP_SIZE, LEARN_MORE_STEP } from '../lib/learnSession'
import { messages, useT, useUiLang } from '../lib/i18n'
import { card, muted, Screen } from '../components/ui'

const M = messages({ title: 'How to use the app', home: 'Home' }, { title: 'Cómo se usa la app', home: 'Inicio' })

/** Grade names as the Spanish Train screen shows them (same order as GRADE_LABELS). */
const GRADE_LABELS_ES = { 1: 'Otra vez', 2: 'Difícil', 3: 'Bien', 4: 'Fácil' } as const

/**
 * A plain-language guide to the app. Button names in quotes match the real UI labels. The page is
 * long, so each language is its own component (same sections in the same order) rather than
 * per-string keys.
 */
export function HowTo() {
  const t = useT(M)
  const lang = useUiLang()
  return (
    <Screen
      title={t.title}
      action={
        <Link to="/" className="-mr-2 inline-flex min-h-11 items-center px-2 text-sm font-medium text-zinc-500 underline dark:text-zinc-400">
          {t.home}
        </Link>
      }
    >
      {lang === 'es' ? <HowToEs /> : <HowToEn />}
    </Screen>
  )
}

function HowToEn() {
  return (
    <>
      <p className="text-sm">
        FlashyCards helps you learn vocabulary in another language, a few words at a time. You add words, the app prepares a translation
        and an example sentence for each one, and then it shows you each word again just before you're likely to forget it.
      </p>

      <Section title="Decks">
        <p>
          A deck holds the words you're learning in one language. To make one, tap <B>Create a deck</B> (or <B>New deck</B> in Settings),
          give it a name and choose the language under <B>I'm learning</B>. You learn from the app's language (see Language below).
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
            up to {MAX_IMPORT_ROWS} words at a time. Imported words skip Learn and go straight to Train, so you can practise them at
            once (decks made before this keep sending them to Learn; change it per deck in Settings with “Imported words go straight to
            Train”).
          </li>
        </ul>
        <p>
          The translation, example sentence and other details come from a hand-checked dictionary, so dictionary words are ready at
          once. A word the dictionary doesn't know shows as “Needs meaning”: open it in Words and type the meaning yourself. Words you
          already have are not added twice: they're listed as “already in your deck”. You can correct any word later.
        </p>
        <p className="font-medium">What the word states mean</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <B>Preparing</B>: it is still being looked up (only for a moment).
          </li>
          <li>
            <B>Ready</B>: it can be learned and reviewed.
          </li>
          <li>
            <B>Needs meaning</B>: the dictionary doesn't know it (or it wasn't recognised as a word). Open it and add the German word and
            its meaning; it's ready to learn straight away.
          </li>
          <li>
            <B>Duplicates</B>: it turned out to be a word you already had, so it isn't studied twice.
          </li>
        </ul>
      </Section>

      <Section title="Learn new words">
        <p>
          Tap <B>Learn new</B> on Home. New words come in groups of {LEARN_GROUP_SIZE}. Each word starts with its meaning in your
          language; tap <B>Show the word</B> (or swipe, or press →) to see it with its article, forms and example, then{' '}
          <B>Got it</B>. Go back with ← or a swipe the other way, or tap <B>I already know this</B> to skip a word. Then a{' '}
          <B>Quick check</B> tests the group, the same way as Train.
        </p>
        <p>
          There's a daily limit for new words so reviews don't pile up. When you reach it, Home says <B>Daily limit reached</B>; you can
          still tap <B>Learn {LEARN_MORE_STEP} more</B> if you want to.
        </p>
      </Section>

      <Section title="Train">
        <p>
          Tap <B>Train</B> on Home to review the words that are due. Type the answer (or tap the microphone and say it; voice input
          works best in Chrome or Edge). A right
          answer turns the card over by itself; otherwise press Enter, or tap <B>Show answer</B> if you don't know. Nouns need their
          article (<B>der Hund</B>, not just Hund). Capitals don't matter, and you can write ae, oe, ue and ss for ä, ö, ü and ß. One
          small typo in a longer word counts as <B>{GRADE_LABELS[2]}</B>.
        </p>
        <p>
          The microphone is a switch: while it's on, every new card listens by itself (it pauses after a few silent tries; tap it
          to resume). Turn on <B>Auto</B> at the top of Train and a right answer moves on to the next card after a second, so
          with both on you can train hands-free; tap anything to stay on the card.
        </p>
        <p>
          The app grades a right answer by how long it took: the time before your first key (or before you start speaking), and
          the time to type it compared with how long that word should take (longer words, umlauts and articles get more time).
          It learns your usual speed on each device, separately for phone and keyboard. The card shows the grade, for example{' '}
          <B>{GRADE_LABELS[3]} · 2.1 s</B>; tap <B>Next</B> (or press Enter) to accept it, or <B>Change</B> to pick another:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <B>{GRADE_LABELS[1]}</B>: you didn't know it. It comes back in a few minutes.
          </li>
          <li>
            <B>{GRADE_LABELS[2]}</B>: you got it, but with effort (a long think or slow typing). It comes back a little sooner.
          </li>
          <li>
            <B>{GRADE_LABELS[3]}</B>: you knew it. This is the usual answer.
          </li>
          <li>
            <B>{GRADE_LABELS[4]}</B>: you knew it instantly (a quick start and quick typing). It waits longer before coming back.
          </li>
        </ul>
        <p>
          Each grade button shows when you'll see the word again. If the app marked you wrong but you were right, tap <B>I was right</B>.
          Be honest: it keeps your reviews well timed.
        </p>
        <p>
          The switch at the top sets the direction: the language you're learning first, your own language first, or Mixed. On the
          back of a card, <B>Listen</B> reads the word and sentence aloud, and <B>Pronunciation video</B> opens a YouTube search for
          videos of a native speaker saying the word. When nothing is due you'll see <B>All done</B>, and{' '}
          <B>Practice anyway</B> lets you review early.
        </p>
        <p className={muted}>With a keyboard: Enter checks the answer and moves on with the app's grade, and 1 to 4 pick {Object.values(GRADE_LABELS).join(', ')}.</p>
      </Section>

      <Section title="How reviews are scheduled">
        <p>
          The app uses spaced repetition: every time you remember a word, the gap before its next review grows, from minutes to days to
          months. Words you forget come back sooner, so your time goes to the words you find hard.
        </p>
      </Section>

      <Section title="Your words">
        <p>
          The <B>Words</B> tab lists everything in the deck. Search, or filter by All, Preparing, Ready, Needs meaning, Suspended or Duplicates.
          Tap a word to open its page.
        </p>
        <p>On a word's page you can:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <B>Edit</B> the translation, extra meanings (“Also means”), the example sentence and its translation, and a note. In a
            sentence, wrap the word in double brackets, like <span className="font-mono">Der [[Hund]] bellt.</span>, to highlight it.
            Leave a field empty to go back to the dictionary text.
          </li>
          <li>
            <B>Suspend</B> a word to stop it appearing in Learn and Train, and <B>Unsuspend</B> it to bring it back.
          </li>
          <li>
            <B>Add the meaning</B> of a word that needs one, or <B>Delete</B> it.
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
            <B>Theme</B>: the app's colours (System follows your device's light or dark mode, or pick Light, Dark, Sepia, Solarized
            Light, Nord or Dracula); saved on this device only.
          </li>
          <li>
            <B>Skip the N most common words</B>: where “Add new words” starts in the frequency list, for this deck.
          </li>
          <li>Create and delete decks, and see the word list credits under About.</li>
          <li>
            <B>Install the app</B>: puts FlashyCards on your home screen, opening in its own window. The button only shows while your
            browser can install it (Chrome, Edge); on iPhone use Share → Add to Home Screen in Safari.
          </li>
        </ul>
      </Section>

      <Section title="Language">
        <p>
          <B>Settings → Language</B>: choose <B>English</B> or <B>Español</B>. The app language is also the language you learn
          from: your decks switch to Spanish (or English) meanings, and your progress and words are kept. Meanings you typed
          yourself stay as you typed them.
        </p>
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
    </>
  )
}

function HowToEs() {
  return (
    <>
      <p className="text-sm">
        FlashyCards te ayuda a aprender vocabulario de otro idioma, unas pocas palabras cada vez. Tú añades palabras, la app prepara
        una traducción y una frase de ejemplo para cada una, y luego te vuelve a mostrar cada palabra justo antes de que se te olvide.
      </p>

      <Section title="Mazos">
        <p>
          Un mazo guarda las palabras que estás aprendiendo de un idioma. Para crear uno, toca <B>Crear un mazo</B> (o{' '}
          <B>Nuevo mazo</B> en Ajustes), ponle un nombre y elige el idioma en <B>Estoy aprendiendo</B>. Aprendes desde el idioma de
          la app (mira Idioma, más abajo).
        </p>
        <p>Si tienes más de un mazo, cambia de uno a otro con el menú de arriba en Inicio. Los mazos se pueden borrar en Ajustes.</p>
      </Section>

      <Section title="Añadir palabras">
        <p>
          Toca <B>Añadir palabras</B>. Hay dos pestañas:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <B>Añadir palabras nuevas</B> añade las palabras más comunes del idioma que todavía no tienes. Elige cuántas (5, 10, 20 o
            Personalizado) y toca <B>Añadir 10 palabras</B>. Si ya sabes lo básico, configura “Saltar las N palabras más comunes” en
            Ajustes.
          </li>
          <li>
            <B>Importar</B> usa tu propia lista. Escribe o pega una palabra por línea, o toca <B>Elegir archivo…</B> para cargar un
            archivo .txt, .csv o .tsv. Puedes añadir un significado después de un tabulador, “;” o “|” (por ejemplo{' '}
            <span className="font-mono">Hund;perro</span>). Las líneas que empiezan por # se ignoran. En “Las palabras están en”, indica
            en qué idioma está tu lista, o elige Automático. Primero verás una vista previa; hasta {MAX_IMPORT_ROWS} palabras cada vez.
            Las palabras importadas se saltan Aprender y van directamente a Repasar, así que puedes practicarlas al momento (los mazos
            creados antes de este cambio las siguen enviando a Aprender; cámbialo por mazo en Ajustes con “Las palabras importadas van
            directamente a Repasar”).
          </li>
        </ul>
        <p>
          La traducción, la frase de ejemplo y los demás detalles vienen de un diccionario revisado a mano, así que las palabras del
          diccionario están listas al momento. Una palabra que el diccionario no conoce aparece como “Falta el significado”: ábrela en
          Palabras y escribe tú el significado. Las palabras que ya tienes no se añaden dos veces: aparecen como “ya está en tu mazo”.
          Puedes corregir cualquier palabra más tarde.
        </p>
        <p className="font-medium">Qué significan los estados de una palabra</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <B>Preparando</B>: todavía se está buscando (solo un momento).
          </li>
          <li>
            <B>Lista</B>: ya se puede aprender y repasar.
          </li>
          <li>
            <B>Falta el significado</B>: el diccionario no la conoce (o no se reconoció como palabra). Ábrela y añade la palabra en
            alemán y su significado; queda lista para aprender enseguida.
          </li>
          <li>
            <B>Duplicadas</B>: resultó ser una palabra que ya tenías, así que no se estudia dos veces.
          </li>
        </ul>
      </Section>

      <Section title="Aprender palabras nuevas">
        <p>
          Toca <B>Aprender nuevas</B> en Inicio. Las palabras nuevas llegan en grupos de {LEARN_GROUP_SIZE}. Cada palabra empieza con
          su significado en tu idioma; toca <B>Ver la palabra</B> (o desliza, o pulsa →) para verla con su artículo, sus formas y un
          ejemplo, y luego <B>Entendido</B>. Vuelve atrás con ← o deslizando hacia el otro lado, o toca <B>Ya me la sé</B> para
          saltarte una palabra. Después, una <B>Comprobación rápida</B> pone a prueba el grupo, igual que en Repasar.
        </p>
        <p>
          Hay un límite diario de palabras nuevas para que no se acumulen los repasos. Cuando llegas a él, Inicio dice{' '}
          <B>Límite diario alcanzado</B>; aun así puedes tocar <B>Aprender {LEARN_MORE_STEP} más</B> si quieres.
        </p>
      </Section>

      <Section title="Repasar">
        <p>
          Toca <B>Repasar</B> en Inicio para repasar las palabras que tocan hoy. Escribe la respuesta (o toca el micrófono y dila; la
          entrada por voz funciona mejor en Chrome o Edge). Si aciertas, la tarjeta se da la vuelta sola; si no, pulsa Intro, o toca{' '}
          <B>Ver respuesta</B> si no la sabes. Los sustantivos necesitan su artículo (<B>der Hund</B>, no solo Hund). Las mayúsculas
          no importan, y puedes escribir ae, oe, ue y ss en lugar de ä, ö, ü y ß. Una pequeña errata en una palabra larga cuenta como{' '}
          <B>{GRADE_LABELS_ES[2]}</B>.
        </p>
        <p>
          El micrófono es un interruptor: mientras está encendido, cada tarjeta nueva escucha sola (se pausa después de unos cuantos
          intentos en silencio; tócalo para seguir). Activa <B>Auto</B> arriba en Repasar y, al acertar, pasarás a la siguiente
          tarjeta al cabo de un segundo; con los dos activados puedes repasar sin manos. Toca cualquier cosa para quedarte en la
          tarjeta.
        </p>
        <p>
          La app pone nota a una respuesta correcta según lo que tardaste: el tiempo hasta tu primera tecla (o hasta que empiezas a
          hablar), y el tiempo que tardas en escribirla comparado con lo que debería llevar esa palabra (las palabras largas, las
          diéresis y los artículos tienen más tiempo). Aprende tu velocidad habitual en cada dispositivo, por separado para el móvil y
          el teclado. La tarjeta muestra la nota, por ejemplo <B>{GRADE_LABELS_ES[3]} · 2,1 s</B>; toca <B>Siguiente</B> (o pulsa
          Intro) para aceptarla, o <B>Cambiar</B> para elegir otra:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <B>{GRADE_LABELS_ES[1]}</B>: no la sabías. Vuelve dentro de unos minutos.
          </li>
          <li>
            <B>{GRADE_LABELS_ES[2]}</B>: la sabías, pero te costó (pensaste mucho o escribiste despacio). Vuelve un poco antes.
          </li>
          <li>
            <B>{GRADE_LABELS_ES[3]}</B>: la sabías. Es la respuesta normal.
          </li>
          <li>
            <B>{GRADE_LABELS_ES[4]}</B>: la sabías al instante (empezaste rápido y escribiste rápido). Tarda más en volver.
          </li>
        </ul>
        <p>
          Cada botón de nota muestra cuándo volverás a ver la palabra. Si la app te marcó un fallo pero tenías razón, toca{' '}
          <B>Tenía razón</B>. Sé sincero: así tus repasos llegan en el momento justo.
        </p>
        <p>
          El interruptor de arriba elige la dirección: primero el idioma que aprendes, primero tu idioma, o Mezclado. En el reverso
          de una tarjeta, <B>Escuchar</B> lee en voz alta la palabra y la frase, y <B>Vídeo de pronunciación</B> abre una búsqueda en
          YouTube de vídeos de un hablante nativo diciendo la palabra. Cuando no toca nada verás <B>Todo hecho</B>, y{' '}
          <B>Practicar de todos modos</B> te deja repasar antes de tiempo.
        </p>
        <p className={muted}>
          Con teclado: Intro comprueba la respuesta y pasa a la siguiente con la nota de la app, y del 1 al 4 eligen{' '}
          {Object.values(GRADE_LABELS_ES).join(', ')}.
        </p>
      </Section>

      <Section title="Cómo se programan los repasos">
        <p>
          La app usa repetición espaciada: cada vez que recuerdas una palabra, el tiempo hasta su próximo repaso crece, de minutos a
          días y a meses. Las palabras que olvidas vuelven antes, así que tu tiempo se dedica a las que te cuestan.
        </p>
      </Section>

      <Section title="Tus palabras">
        <p>
          La pestaña <B>Palabras</B> muestra todo lo que hay en el mazo. Busca, o filtra por Todas, Preparando, Listas, Falta el
          significado, Suspendidas o Duplicadas. Toca una palabra para abrir su página.
        </p>
        <p>En la página de una palabra puedes:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <B>Editar</B> la traducción, otros significados (“También significa”), la frase de ejemplo y su traducción, y una nota. En
            una frase, pon la palabra entre dobles corchetes, como <span className="font-mono">Der [[Hund]] bellt.</span>, para
            resaltarla. Deja un campo vacío para volver al texto del diccionario.
          </li>
          <li>
            <B>Suspender</B> una palabra para que deje de salir en Aprender y Repasar, y <B>Reactivar</B> para recuperarla.
          </li>
          <li>
            <B>Añadir el significado</B> de una palabra que lo necesita, o <B>Borrarla</B>.
          </li>
        </ul>
      </Section>

      <Section title="Ajustes">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <B>Leer las palabras en voz alta</B>: dice la palabra automáticamente cuando se presenta una palabra nueva y cuando ves una
            respuesta.
          </li>
          <li>
            <B>Ocultar la frase en el anverso</B>: muestra solo la palabra hasta que ves la respuesta, lo que lo hace más difícil.
          </li>
          <li>
            <B>Tema</B>: los colores de la app (Sistema sigue el modo claro u oscuro de tu dispositivo, o elige Claro, Oscuro, Sepia,
            Solarized Light, Nord o Dracula); se guarda solo en este dispositivo.
          </li>
          <li>
            <B>Saltar las N palabras más comunes</B>: dónde empieza “Añadir palabras nuevas” en la lista de frecuencia, para este mazo.
          </li>
          <li>Crear y borrar mazos, y ver los créditos de la lista de palabras en Acerca de.</li>
          <li>
            <B>Instalar la app</B>: pone FlashyCards en tu pantalla de inicio y se abre en su propia ventana. El botón solo aparece
            cuando tu navegador puede instalarla (Chrome, Edge); en iPhone usa Compartir → Añadir a pantalla de inicio en Safari.
          </li>
        </ul>
      </Section>

      <Section title="Idioma">
        <p>
          <B>Ajustes → Idioma</B>: elige <B>English</B> o <B>Español</B>. El idioma de la app es también el idioma desde el que
          aprendes: tus mazos pasan a tener los significados en español (o en inglés), y se conservan tu progreso y tus palabras. Los
          significados que escribiste tú se quedan tal como los escribiste.
        </p>
      </Section>

      <Section title="Conexión débil">
        <p>
          Si se corta la conexión en mitad de Aprender o Repasar, sigue: tus respuestas se guardan en el móvil y se envían solas
          cuando vuelves a tener conexión. Necesitas conexión para abrir la app y para añadir palabras.
        </p>
      </Section>

      <Section title="Añádela a tu pantalla de inicio">
        <p>Instala la app para abrirla como cualquier otra, a pantalla completa.</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <B>iPhone (Safari)</B>: toca Compartir y luego <B>Añadir a pantalla de inicio</B>.
          </li>
          <li>
            <B>Android (Chrome)</B>: toca el menú ⋮ y luego <B>Instalar aplicación</B> o <B>Añadir a pantalla de inicio</B>.
          </li>
        </ul>
      </Section>

      <Section title="Consejos">
        <ul className="list-disc space-y-1 pl-5">
          <li>Estudia un poco cada día. Diez minutos diarios valen más que una hora a la semana.</li>
          <li>Haz tus repasos en Repasar antes de aprender palabras nuevas.</li>
          <li>Di la palabra en voz alta, o toca Escuchar, para recordar también cómo suena.</li>
          <li>Añade palabras que te encuentres de verdad, en libros, series o conversaciones.</li>
          <li>Si una traducción o una frase parece incorrecta, corrígela con Editar.</li>
        </ul>
      </Section>
    </>
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
