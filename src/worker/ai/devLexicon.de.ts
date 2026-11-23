/**
 * Dev lexicon for German (en -> de): realistic generator output for the FakeGenerator only, so
 * local runs (`npm run dev`, AI_PROVIDER=fake) and e2e show real-looking cards without an
 * Anthropic key. Never used by the Anthropic path.
 *
 * Coverage: ranks 1-170 of data/wordlists/de.json (what "Add X new words" suggests first with
 * skipTopN 0), minus the words fake.ts already defines (gehen, Haus, essen), plus common words a
 * learner is likely to type. Each entry is one generator item (schema.ts ItemSchema, PROMPT_VERSION
 * 3) without input/input_side/status; test/worker/devLexicon.test.ts validates them all.
 */
import type { Gender, GeneratedItem, Grammar } from './schema'

export type DevEntry = Omit<GeneratedItem, 'input' | 'input_side' | 'status'>
type Cefr = NonNullable<GeneratedItem['cefr']>
type Ex = [target: string, source: string]

const ARTICLE: Record<Gender, string> = { masculine: 'der', feminine: 'die', neuter: 'das' }

function grammar(g: Partial<Grammar>): Grammar {
  return { gender: null, article: null, plural: null, genitive: null, verb: null, governs_case: null, comparative: null, superlative: null, note: null, ...g }
}

function entry(lemma: string, pos: DevEntry['pos'], translation: string, alts: string[], cefr: Cefr, g: Grammar, [t, s]: Ex): DevEntry {
  return { lemma, pos, translation, alt_translations: alts, cefr, grammar: g, example_target: t, example_source: s }
}

/** Noun: plural with its article (null when there is none), genitive with its article. */
function n(lemma: string, gender: Gender | null, plural: string | null, genitive: string | null, translation: string, alts: string[], cefr: Cefr, ex: Ex, note: string | null = null): DevEntry {
  return entry(lemma, 'noun', translation, alts, cefr, grammar({ gender, article: gender ? ARTICLE[gender] : null, plural, genitive, note }), ex)
}

type VerbOpts = { note?: string; separable?: boolean; reflexive?: boolean; governs?: string }

/**
 * Verb: present and past tables as "ich,du,er,wir,ihr,sie"; perfect_3sg as "hat gemacht"
 * (auxiliary from its first word, participle from its last).
 */
function v(lemma: string, translation: string, alts: string[], cefr: Cefr, present: string, past: string, perfect: string, ex: Ex, o: VerbOpts = {}): DevEntry {
  const table = (s: string) => {
    const p = s.split(',')
    if (p.length !== 6) throw new Error(`dev lexicon: bad table for ${lemma}`)
    return { p1s: p[0]!, p2s: p[1]!, p3s: p[2]!, p1p: p[3]!, p2p: p[4]!, p3p: p[5]! }
  }
  const pres = table(present)
  const prät = table(past)
  const words = perfect.split(' ')
  return entry(
    lemma,
    'verb',
    translation,
    alts,
    cefr,
    grammar({
      verb: {
        present: pres,
        past: prät,
        present_3sg: pres.p3s,
        past_3sg: prät.p3s,
        perfect_3sg: perfect,
        participle: words[words.length - 1]!,
        auxiliary: words[0] === 'ist' ? 'sein' : 'haben',
        separable: o.separable ?? false,
        reflexive: o.reflexive ?? false,
      },
      governs_case: o.governs ?? null,
      note: o.note ?? null,
    }),
    ex,
  )
}

/** Adjective: comparative/superlative only when irregular (umlaut or other stem change). */
function a(lemma: string, translation: string, alts: string[], cefr: Cefr, ex: Ex, comparative: string | null = null, superlative: string | null = null, note: string | null = null): DevEntry {
  return entry(lemma, 'adjective', translation, alts, cefr, grammar({ comparative, superlative, note }), ex)
}

/** Preposition with the case it governs. */
function p(lemma: string, governs: string, translation: string, alts: string[], cefr: Cefr, ex: Ex, note: string | null = null): DevEntry {
  return entry(lemma, 'preposition', translation, alts, cefr, grammar({ governs_case: governs, note }), ex)
}

/** Any other part of speech (adverb, pronoun, conjunction, article, numeral, interjection). */
function w(lemma: string, pos: DevEntry['pos'], translation: string, alts: string[], cefr: Cefr, ex: Ex, note: string | null = null): DevEntry {
  return entry(lemma, pos, translation, alts, cefr, grammar({ note }), ex)
}

const MODAL = 'Modal verb: with an infinitive the Perfekt uses the infinitive (hat ... können).'

export const DEV_LEXICON_DE: readonly DevEntry[] = [
  // ---- word list, ranks 1-50 ----
  w('ich', 'pronoun', 'I', [], 'A1', ['[[Ich]] wohne in Berlin.', '[[I]] live in Berlin.'], 'Accusative mich, dative mir.'),
  w('sie', 'pronoun', 'she', ['they', 'her', 'them'], 'A1', ['[[Sie]] kommt aus Spanien.', '[[She]] comes from Spain.'], 'With a plural verb sie means "they"; capitalised Sie is the formal "you".'),
  w('der', 'article', 'the', [], 'A1', ['[[Der]] Bus kommt gleich.', '[[The]] bus is coming soon.'], 'Masculine nominative (also feminine dative/genitive). Feminine die, neuter das, plural die.'),
  v('sein', 'to be', [], 'A1', 'bin,bist,ist,sind,seid,sind', 'war,warst,war,waren,wart,waren', 'ist gewesen', ['Ich [[bin]] heute sehr müde.', 'I [[am]] very tired today.']),
  w('du', 'pronoun', 'you', [], 'A1', ['Kommst [[du]] heute Abend mit?', 'Are [[you]] coming along tonight?'], 'Informal "you" for one person. Accusative dich, dative dir.'),
  w('nicht', 'adverb', 'not', [], 'A1', ['Das ist [[nicht]] mein Auto.', 'That is [[not]] my car.']),
  w('es', 'pronoun', 'it', [], 'A1', ['[[Es]] regnet schon den ganzen Tag.', '[[It]] has been raining all day.']),
  w('und', 'conjunction', 'and', [], 'A1', ['Ich trinke einen Kaffee [[und]] lese die Zeitung.', 'I drink a coffee [[and]] read the paper.']),
  w('wir', 'pronoun', 'we', [], 'A1', ['[[Wir]] wohnen in Hamburg.', '[[We]] live in Hamburg.'], 'Accusative and dative uns.'),
  w('was', 'pronoun', 'what', [], 'A1', ['[[Was]] machst du am Wochenende?', '[[What]] are you doing at the weekend?']),
  p('zu', 'dative', 'to', ['at', 'too'], 'A1', ['Ich gehe heute [[zu]] meiner Oma.', 'I am going [[to]] my grandma’s today.'], 'zu + dem = zum, zu + der = zur. As an adverb: zu groß = too big.'),
  w('er', 'pronoun', 'he', ['it'], 'A1', ['[[Er]] arbeitet in einer Bank.', '[[He]] works in a bank.'], 'Accusative ihn, dative ihm. Also "it" for masculine nouns.'),
  w('ein', 'article', 'a', ['an', 'one'], 'A1', ['Ich habe [[einen]] Bruder.', 'I have [[a]] brother.'], 'Indefinite article: ein (masculine/neuter), eine (feminine); accusative masculine einen.'),
  p('in', 'accusative or dative', 'in', ['into', 'to'], 'A1', ['Wir wohnen [[in]] einer kleinen Stadt.', 'We live [[in]] a small town.'], 'Dative for location (wo?), accusative for direction (wohin?). in + dem = im, in + das = ins.'),
  w('ja', 'adverb', 'yes', [], 'A1', ['[[Ja]], ich komme gern mit.', '[[Yes]], I’d love to come along.'], 'Also a modal particle: Das ist ja toll!'),
  p('mit', 'dative', 'with', ['by'], 'A1', ['Ich gehe [[mit]] meiner Schwester ins Kino.', 'I am going to the cinema [[with]] my sister.'], 'Transport: mit dem Bus = by bus.'),
  w('wie', 'adverb', 'how', ['like', 'as'], 'A1', ['[[Wie]] geht es dir?', '[[How]] are you?']),
  p('auf', 'accusative or dative', 'on', ['onto', 'at'], 'A1', ['Das Buch liegt [[auf]] dem Tisch.', 'The book is lying [[on]] the table.'], 'Dative for position (wo?), accusative for movement onto (wohin?).'),
  w('dass', 'conjunction', 'that', [], 'A1', ['Ich glaube, [[dass]] er recht hat.', 'I think [[that]] he is right.'], 'Subordinating: the verb goes to the end.'),
  w('aber', 'conjunction', 'but', ['however'], 'A1', ['Das Essen ist gut, [[aber]] teuer.', 'The food is good [[but]] expensive.']),
  w('so', 'adverb', 'so', ['like this', 'such'], 'A1', ['Das Wetter ist heute [[so]] schön!', 'The weather is [[so]] nice today!']),
  v('haben', 'to have', [], 'A1', 'habe,hast,hat,haben,habt,haben', 'hatte,hattest,hatte,hatten,hattet,hatten', 'hat gehabt', ['Wir [[haben]] einen kleinen Hund.', 'We [[have]] a small dog.']),
  w('hier', 'adverb', 'here', [], 'A1', ['Ich wohne schon lange [[hier]].', 'I have lived [[here]] for a long time.']),
  p('für', 'accusative', 'for', [], 'A1', ['Das Geschenk ist [[für]] dich.', 'The present is [[for]] you.']),
  p('von', 'dative', 'from', ['of', 'by'], 'A1', ['Ich komme gerade [[von]] der Arbeit.', 'I am just coming [[from]] work.'], 'von + dem = vom.'),
  w('wenn', 'conjunction', 'if', ['when', 'whenever'], 'A2', ['[[Wenn]] es regnet, bleiben wir zu Hause.', '[[If]] it rains, we stay at home.'], 'Subordinating: the verb goes to the end.'),
  w('ihr', 'pronoun', 'you (plural)', ['her', 'their'], 'A1', ['Kommt [[ihr]] morgen mit?', 'Are [[you]] coming along tomorrow?'], 'Informal "you" for several people; also dative "(to) her" and possessive "her/their".'),
  w('nein', 'adverb', 'no', [], 'A1', ['[[Nein]], danke.', '[[No]], thank you.']),
  p('an', 'accusative or dative', 'at', ['on', 'to'], 'A1', ['Wir treffen uns [[an]] der Haltestelle.', 'We’ll meet [[at]] the bus stop.'], 'Dative for position, accusative for direction. an + dem = am, an + das = ans.'),
  w('noch', 'adverb', 'still', ['yet', 'more', 'else'], 'A1', ['Ich bin [[noch]] müde.', 'I am [[still]] tired.'], 'noch nicht = not yet; noch ein Kaffee = another coffee.'),
  w('nur', 'adverb', 'only', ['just'], 'A1', ['Ich habe [[nur]] zehn Euro dabei.', 'I [[only]] have ten euros on me.']),
  w('da', 'adverb', 'there', ['here', 'then'], 'A1', ['Ist Anna [[da]]?', 'Is Anna [[there]]?'], 'Also a conjunction: da = since, because.'),
  w('sich', 'pronoun', 'oneself', ['himself', 'herself', 'themselves'], 'A2', ['Er wäscht [[sich]] jeden Morgen kalt.', 'He washes [[himself]] in cold water every morning.'], 'Reflexive pronoun for er, sie, es, sie (plural) and Sie.'),
  v('können', 'can', ['to be able to'], 'A1', 'kann,kannst,kann,können,könnt,können', 'konnte,konntest,konnte,konnten,konntet,konnten', 'hat gekonnt', ['[[Kannst]] du mir bitte helfen?', '[[Can]] you help me, please?'], { note: MODAL }),
  a('gut', 'good', ['well', 'fine'], 'A1', ['Das Essen hier ist sehr [[gut]].', 'The food here is very [[good]].'], 'besser', 'am besten'),
  w('auch', 'adverb', 'also', ['too', 'as well'], 'A1', ['Ich komme [[auch]] mit.', 'I’m coming along [[too]].']),
  w('schon', 'adverb', 'already', ['yet'], 'A1', ['Bist du [[schon]] fertig?', 'Are you [[already]] finished?']),
  w('als', 'conjunction', 'when', ['as', 'than'], 'A2', ['[[Als]] ich klein war, wohnten wir in Köln.', '[[When]] I was little, we lived in Cologne.'], 'als = when (a single event in the past); after a comparative = than.'),
  w('mal', 'adverb', 'just', ['once', 'times'], 'A1', ['Warte [[mal]], ich komme mit!', 'Wait [[just]] a moment, I’m coming too!'], 'Softens requests (Komm mal her!); also "times": drei mal drei.'),
  w('jetzt', 'adverb', 'now', [], 'A1', ['Ich muss [[jetzt]] gehen.', 'I have to go [[now]].']),
  w('dann', 'adverb', 'then', [], 'A1', ['Erst essen wir, [[dann]] gehen wir spazieren.', 'First we eat, [[then]] we go for a walk.']),
  p('aus', 'dative', 'from', ['out of', 'made of'], 'A1', ['Ich komme [[aus]] Italien.', 'I come [[from]] Italy.']),
  w('mein', 'pronoun', 'my', ['mine'], 'A1', ['Das ist [[mein]] Bruder.', 'That is [[my]] brother.'], 'Possessive: mein (masculine/neuter), meine (feminine/plural).'),
  p('um', 'accusative', 'at', ['around'], 'A1', ['Der Kurs beginnt [[um]] neun Uhr.', 'The course starts [[at]] nine o’clock.'], 'For clock times: um acht Uhr. um ... zu = in order to.'),
  v('werden', 'to become', ['to get', 'will'], 'A1', 'werde,wirst,wird,werden,werdet,werden', 'wurde,wurdest,wurde,wurden,wurdet,wurden', 'ist geworden', ['Im Herbst [[wird]] es früh dunkel.', 'In autumn it [[gets]] dark early.'], { note: 'Also forms the future (ich werde kommen) and the passive (participle worden).' }),
  w('doch', 'adverb', 'after all', ['yes', 'but', 'really'], 'A2', ['Du hast [[doch]] recht.', 'You are right [[after all]].'], 'Answers a negative question with "yes": Kommst du nicht? – Doch!'),
  w('alles', 'pronoun', 'everything', ['all'], 'A1', ['[[Alles]] ist gut.', '[[Everything]] is fine.']),
  v('wissen', 'to know', [], 'A1', 'weiß,weißt,weiß,wissen,wisst,wissen', 'wusste,wusstest,wusste,wussten,wusstet,wussten', 'hat gewusst', ['Ich [[weiß]] seine Adresse nicht.', 'I don’t [[know]] his address.'], { note: 'To know a fact; to know a person or place is kennen.' }),
  w('kein', 'article', 'no', ['not a', 'not any'], 'A1', ['Ich habe heute [[keine]] Zeit.', 'I have [[no]] time today.'], 'Negative article: kein (masculine/neuter), keine (feminine/plural).'),
  w('oder', 'conjunction', 'or', [], 'A1', ['Möchtest du Tee [[oder]] Kaffee?', 'Would you like tea [[or]] coffee?']),

  // ---- ranks 51-100 ----
  p('nach', 'dative', 'after', ['to', 'according to'], 'A1', ['[[Nach]] dem Essen gehen wir spazieren.', '[[After]] the meal we go for a walk.'], 'Also "to" for towns and countries without an article: nach Berlin; nach Hause = home.'),
  w('nichts', 'pronoun', 'nothing', ['not anything'], 'A1', ['Ich habe [[nichts]] gesagt.', 'I said [[nothing]].']),
  w('man', 'pronoun', 'one', ['you', 'people'], 'A1', ['Hier darf [[man]] nicht rauchen.', '[[You]] are not allowed to smoke here.'], 'Impersonal "one/you", always with a 3rd person singular verb.'),
  v('müssen', 'must', ['to have to'], 'A1', 'muss,musst,muss,müssen,müsst,müssen', 'musste,musstest,musste,mussten,musstet,mussten', 'hat gemusst', ['Ich [[muss]] heute lange arbeiten.', 'I [[have to]] work late today.'], { note: MODAL }),
  v('wollen', 'to want', [], 'A1', 'will,willst,will,wollen,wollt,wollen', 'wollte,wolltest,wollte,wollten,wolltet,wollten', 'hat gewollt', ['Wir [[wollen]] heute ins Kino gehen.', 'We [[want]] to go to the cinema today.'], { note: MODAL }),
  w('wo', 'adverb', 'where', [], 'A1', ['[[Wo]] wohnst du?', '[[Where]] do you live?']),
  w('etwas', 'pronoun', 'something', ['a little', 'some'], 'A1', ['Möchtest du [[etwas]] trinken?', 'Would you like [[something]] to drink?']),
  w('mehr', 'adverb', 'more', [], 'A1', ['Ich brauche [[mehr]] Zeit.', 'I need [[more]] time.'], 'Comparative of viel. nicht mehr = no longer.'),
  p('bei', 'dative', 'with', ['at', 'near'], 'A1', ['Ich wohne noch [[bei]] meinen Eltern.', 'I still live [[with]] my parents.'], 'bei + dem = beim. bei Anna = at Anna’s place.'),
  w('also', 'adverb', 'so', ['therefore', 'well'], 'A1', ['Es regnet, [[also]] bleiben wir zu Hause.', 'It’s raining, [[so]] we’re staying at home.'], 'False friend: English "also" is auch.'),
  w('bitte', 'adverb', 'please', ['you’re welcome', 'pardon'], 'A1', ['Einen Kaffee, [[bitte]].', 'A coffee, [[please]].'], 'Also the answer to danke: Bitte! = You’re welcome!'),
  w('immer', 'adverb', 'always', [], 'A1', ['Er kommt [[immer]] zu spät.', 'He is [[always]] late.']),
  w('warum', 'adverb', 'why', [], 'A1', ['[[Warum]] lernst du Deutsch?', '[[Why]] are you learning German?']),
  p('vor', 'accusative or dative', 'in front of', ['before', 'ago'], 'A1', ['Das Auto steht [[vor]] dem Haus.', 'The car is [[in front of]] the house.'], 'With dative also "ago": vor zwei Jahren = two years ago.'),
  w('los', 'adverb', 'off', ['loose', 'going'], 'A2', ['Was ist [[los]]?', 'What’s [[the matter]]?'], 'Was ist los? = What’s wrong? Los geht’s! = Let’s go!'),
  w('wieder', 'adverb', 'again', ['back'], 'A1', ['Es regnet schon [[wieder]].', 'It’s raining [[again]].']),
  v('sagen', 'to say', ['to tell'], 'A1', 'sage,sagst,sagt,sagen,sagt,sagen', 'sagte,sagtest,sagte,sagten,sagtet,sagten', 'hat gesagt', ['Was [[sagst]] du dazu?', 'What do you [[say]] to that?']),
  v('machen', 'to do', ['to make'], 'A1', 'mache,machst,macht,machen,macht,machen', 'machte,machtest,machte,machten,machtet,machten', 'hat gemacht', ['Was [[machst]] du am Wochenende?', 'What are you [[doing]] at the weekend?']),
  w('danke', 'interjection', 'thanks', ['thank you'], 'A1', ['[[Danke]] für deine Hilfe!', '[[Thanks]] for your help!']),
  w('sehr', 'adverb', 'very', ['very much'], 'A1', ['Das Wetter ist heute [[sehr]] schön.', 'The weather is [[very]] nice today.']),
  w('alle', 'pronoun', 'all', ['everyone', 'everybody'], 'A1', ['[[Alle]] sind schon da.', '[[Everyone]] is already here.']),
  w('denn', 'conjunction', 'for', ['because', 'then'], 'A2', ['Ich bleibe zu Hause, [[denn]] ich bin krank.', 'I’m staying at home, [[for]] I am ill.'], 'Coordinating: normal word order after it. Also a particle in questions: Was ist denn los?'),
  n('Mann', 'masculine', 'die Männer', 'des Mannes', 'man', ['husband'], 'A1', ['Der [[Mann]] liest die Zeitung.', 'The [[man]] is reading the newspaper.']),
  v('tun', 'to do', [], 'A1', 'tue,tust,tut,tun,tut,tun', 'tat,tatest,tat,taten,tatet,taten', 'hat getan', ['Was kann ich für dich [[tun]]?', 'What can I [[do]] for you?']),
  v('sehen', 'to see', ['to look', 'to watch'], 'A1', 'sehe,siehst,sieht,sehen,seht,sehen', 'sah,sahst,sah,sahen,saht,sahen', 'hat gesehen', ['[[Siehst]] du das Haus dort drüben?', 'Do you [[see]] the house over there?']),
  w('vielleicht', 'adverb', 'maybe', ['perhaps'], 'A1', ['[[Vielleicht]] regnet es morgen.', '[[Maybe]] it will rain tomorrow.']),
  w('wer', 'pronoun', 'who', [], 'A1', ['[[Wer]] ist das?', '[[Who]] is that?'], 'Accusative wen, dative wem.'),
  w('dieser', 'pronoun', 'this', ['that'], 'A1', ['[[Dieser]] Film ist wirklich gut.', '[[This]] film is really good.'], 'dieser (masculine), diese (feminine/plural), dieses (neuter).'),
  v('kommen', 'to come', ['to arrive'], 'A1', 'komme,kommst,kommt,kommen,kommt,kommen', 'kam,kamst,kam,kamen,kamt,kamen', 'ist gekommen', ['Woher [[kommst]] du?', 'Where do you [[come]] from?']),
  p('über', 'accusative or dative', 'over', ['above', 'about', 'via'], 'A1', ['Die Lampe hängt [[über]] dem Tisch.', 'The lamp hangs [[above]] the table.'], 'Dative for position, accusative for movement; über + accusative also means "about" a topic.'),
  v('geben', 'to give', [], 'A1', 'gebe,gibst,gibt,geben,gebt,geben', 'gab,gabst,gab,gaben,gabt,gaben', 'hat gegeben', ['Kannst du mir bitte das Salz [[geben]]?', 'Can you [[give]] me the salt, please?'], { note: 'es gibt + accusative = there is / there are.' }),
  w('dein', 'pronoun', 'your', ['yours'], 'A1', ['Ist das [[dein]] Fahrrad?', 'Is that [[your]] bike?'], 'Informal possessive: dein (masculine/neuter), deine (feminine/plural).'),
  v('sollen', 'should', ['to be supposed to'], 'A2', 'soll,sollst,soll,sollen,sollt,sollen', 'sollte,solltest,sollte,sollten,solltet,sollten', 'hat gesollt', ['Was [[soll]] ich jetzt machen?', 'What [[should]] I do now?'], { note: MODAL }),
  w('nie', 'adverb', 'never', [], 'A1', ['Ich trinke [[nie]] Kaffee.', 'I [[never]] drink coffee.']),
  w('wirklich', 'adverb', 'really', ['truly'], 'A1', ['Der Kuchen ist [[wirklich]] lecker.', 'The cake is [[really]] tasty.']),
  a('viel', 'much', ['a lot', 'many'], 'A1', ['Ich habe heute [[viel]] Arbeit.', 'I have [[a lot of]] work today.'], 'mehr', 'am meisten'),
  w('weg', 'adverb', 'away', ['gone', 'off'], 'A2', ['Mein Schlüssel ist [[weg]].', 'My key is [[gone]].'], 'Not to be confused with der Weg (the way, path).'),
  a('einfach', 'simple', ['easy', 'just'], 'A1', ['Die Aufgabe ist ganz [[einfach]].', 'The task is quite [[simple]].'], null, null, 'As an adverb also "just": Komm einfach mit!'),
  n('Leben', 'neuter', 'die Leben', 'des Lebens', 'life', [], 'A1', ['Das [[Leben]] in der Stadt ist teuer.', '[[Life]] in the city is expensive.']),
  n('Zeit', 'feminine', 'die Zeiten', 'der Zeit', 'time', [], 'A1', ['Hast du heute Abend [[Zeit]]?', 'Do you have [[time]] this evening?']),
  w('weil', 'conjunction', 'because', [], 'A1', ['Ich lerne Deutsch, [[weil]] ich in Berlin arbeite.', 'I’m learning German [[because]] I work in Berlin.'], 'Subordinating: the verb goes to the end.'),
  w('heute', 'adverb', 'today', [], 'A1', ['[[Heute]] ist Montag.', '[[Today]] is Monday.']),
  w('damit', 'adverb', 'with it', ['with that', 'so that'], 'A2', ['Was machst du [[damit]]?', 'What are you doing [[with it]]?'], 'As a conjunction: so that (verb to the end).'),
  a('ganz', 'whole', ['entire', 'quite', 'completely'], 'A1', ['Ich habe den [[ganzen]] Tag gearbeitet.', 'I worked the [[whole]] day.']),
  a('sicher', 'sure', ['safe', 'certain'], 'A2', ['Bist du [[sicher]]?', 'Are you [[sure]]?']),
  n('Frau', 'feminine', 'die Frauen', 'der Frau', 'woman', ['wife', 'Mrs'], 'A1', ['Die [[Frau]] trinkt einen Tee.', 'The [[woman]] is drinking a tea.']),
  w('nun', 'adverb', 'now', ['well'], 'A2', ['Was machen wir [[nun]]?', 'What do we do [[now]]?']),
  p('bis', 'accusative', 'until', ['till', 'by', 'to'], 'A1', ['Der Laden ist [[bis]] acht Uhr offen.', 'The shop is open [[until]] eight o’clock.'], 'Usually without an article; otherwise bis zu + dative. Bis bald! = See you soon!'),
  v('leidtun', 'to be sorry', ['to regret'], 'A1', 'tue leid,tust leid,tut leid,tun leid,tut leid,tun leid', 'tat leid,tatest leid,tat leid,taten leid,tatet leid,taten leid', 'hat leidgetan', ['Es [[tut]] mir [[leid]].', 'I am [[sorry]].'], { separable: true, governs: 'dative', note: 'Used with the dative: Es tut mir leid = I’m sorry.' }),

  // ---- ranks 101-150 ----
  w('zurück', 'adverb', 'back', [], 'A1', ['Ich bin um acht Uhr [[zurück]].', 'I’ll be [[back]] at eight o’clock.']),
  v('lassen', 'to let', ['to leave'], 'A2', 'lasse,lässt,lässt,lassen,lasst,lassen', 'ließ,ließest,ließ,ließen,ließt,ließen', 'hat gelassen', ['Ich [[lasse]] das Fenster offen.', 'I’m [[leaving]] the window open.'], { note: 'With an infinitive also "to have something done": Ich lasse mir die Haare schneiden.' }),
  w('hallo', 'interjection', 'hello', ['hi'], 'A1', ['[[Hallo]], wie geht’s?', '[[Hello]], how are you?']),
  n('Gott', 'masculine', 'die Götter', 'des Gottes', 'God', [], 'A2', ['Oh mein [[Gott]]!', 'Oh my [[God]]!']),
  w('zwei', 'numeral', 'two', [], 'A1', ['Ich habe [[zwei]] Schwestern.', 'I have [[two]] sisters.']),
  a('genau', 'exact', ['exactly', 'precise'], 'A1', ['[[Genau]], das meine ich.', '[[Exactly]], that’s what I mean.']),
  a('klar', 'clear', ['of course', 'sure'], 'A1', ['[[Klar]], ich helfe dir!', '[[Sure]], I’ll help you!']),
  w('morgen', 'adverb', 'tomorrow', [], 'A1', ['Wir sehen uns [[morgen]].', 'See you [[tomorrow]].'], 'der Morgen (capitalised) = the morning.'),
  n('Leute', null, 'die Leute', 'der Leute', 'people', ['folks'], 'A1', ['Die [[Leute]] hier sind sehr nett.', 'The [[people]] here are very nice.'], 'Plural only (die Leute).'),
  n('Vater', 'masculine', 'die Väter', 'des Vaters', 'father', ['dad'], 'A1', ['Mein [[Vater]] kocht sehr gern.', 'My [[father]] loves cooking.']),
  a('schön', 'beautiful', ['nice', 'lovely'], 'A1', ['Was für ein [[schöner]] Tag!', 'What a [[beautiful]] day!']),
  v('glauben', 'to believe', ['to think'], 'A1', 'glaube,glaubst,glaubt,glauben,glaubt,glauben', 'glaubte,glaubtest,glaubte,glaubten,glaubtet,glaubten', 'hat geglaubt', ['Ich [[glaube]], er kommt heute nicht.', 'I [[think]] he isn’t coming today.'], { note: 'jemandem glauben (dative) = to believe someone; an etwas glauben = to believe in something.' }),
  p('ab', 'dative', 'from', ['starting', 'off'], 'A2', ['[[Ab]] Montag arbeite ich wieder.', '[[From]] Monday I’m working again.']),
  w('gerade', 'adverb', 'right now', ['just', 'straight'], 'A1', ['Ich koche [[gerade]].', 'I’m cooking [[right now]].']),
  n('Tag', 'masculine', 'die Tage', 'des Tages', 'day', [], 'A1', ['Der [[Tag]] war lang.', 'The [[day]] was long.'], 'Guten Tag! = Hello! / Good day!'),
  v('reden', 'to talk', ['to speak'], 'A2', 'rede,redest,redet,reden,redet,reden', 'redete,redetest,redete,redeten,redetet,redeten', 'hat geredet', ['Wir müssen [[reden]].', 'We need to [[talk]].']),
  w('wohl', 'adverb', 'probably', ['well', 'indeed'], 'B1', ['Er ist [[wohl]] krank.', 'He is [[probably]] ill.']),
  v('lieben', 'to love', [], 'A1', 'liebe,liebst,liebt,lieben,liebt,lieben', 'liebte,liebtest,liebte,liebten,liebtet,liebten', 'hat geliebt', ['Ich [[liebe]] dich.', 'I [[love]] you.']),
  n('Liebe', 'feminine', null, 'der Liebe', 'love', [], 'A2', ['Die [[Liebe]] ist stärker als alles.', '[[Love]] is stronger than anything.'], 'No plural in this sense.'),
  w('unser', 'pronoun', 'our', ['ours'], 'A1', ['Das ist [[unser]] Haus.', 'That is [[our]] house.']),
  w('jemand', 'pronoun', 'someone', ['somebody', 'anyone'], 'A2', ['Ist [[jemand]] zu Hause?', 'Is [[anyone]] at home?']),
  n('Geld', 'neuter', 'die Gelder', 'des Geldes', 'money', [], 'A1', ['Ich habe kein [[Geld]] dabei.', 'I don’t have any [[money]] on me.'], 'The plural die Gelder means funds.'),
  p('durch', 'accusative', 'through', ['by'], 'A2', ['Wir gehen [[durch]] den Park.', 'We walk [[through]] the park.']),
  w('ob', 'conjunction', 'whether', ['if'], 'A2', ['Ich weiß nicht, [[ob]] er kommt.', 'I don’t know [[whether]] he is coming.'], 'Subordinating: the verb goes to the end.'),
  n('Mutter', 'feminine', 'die Mütter', 'der Mutter', 'mother', ['mum'], 'A1', ['Meine [[Mutter]] arbeitet als Ärztin.', 'My [[mother]] works as a doctor.']),
  w('raus', 'adverb', 'out', [], 'A2', ['Komm, wir gehen [[raus]]!', 'Come on, let’s go [[out]]!'], 'Colloquial for heraus/hinaus.'),
  w('paar', 'pronoun', 'a few', ['a couple of'], 'A1', ['Ich bleibe noch ein [[paar]] Tage.', 'I’m staying a [[few]] more days.'], 'ein paar = a few; das Paar = the pair, the couple.'),
  v('passieren', 'to happen', [], 'A2', 'passiere,passierst,passiert,passieren,passiert,passieren', 'passierte,passiertest,passierte,passierten,passiertet,passierten', 'ist passiert', ['Was ist [[passiert]]?', 'What [[happened]]?']),
  v('denken', 'to think', [], 'A1', 'denke,denkst,denkt,denken,denkt,denken', 'dachte,dachtest,dachte,dachten,dachtet,dachten', 'hat gedacht', ['Ich [[denke]] oft an dich.', 'I often [[think]] of you.'], { note: 'denken an + accusative = to think of.' }),
  w('wieso', 'adverb', 'why', [], 'A2', ['[[Wieso]] lachst du?', '[[Why]] are you laughing?']),
  w('selbst', 'pronoun', 'oneself', ['myself', 'yourself', 'even'], 'A2', ['Das habe ich [[selbst]] gemacht.', 'I made that [[myself]].'], 'Before a noun also "even": selbst Kinder wissen das.'),
  v('hören', 'to hear', ['to listen to'], 'A1', 'höre,hörst,hört,hören,hört,hören', 'hörte,hörtest,hörte,hörten,hörtet,hörten', 'hat gehört', ['[[Hörst]] du die Musik?', 'Do you [[hear]] the music?']),
  v('mögen', 'to like', [], 'A1', 'mag,magst,mag,mögen,mögt,mögen', 'mochte,mochtest,mochte,mochten,mochtet,mochten', 'hat gemocht', ['Ich [[mag]] Schokolade.', 'I [[like]] chocolate.'], { note: 'ich möchte (I would like) is its subjunctive.' }),
  p('ohne', 'accusative', 'without', [], 'A1', ['Ich trinke Kaffee [[ohne]] Zucker.', 'I drink coffee [[without]] sugar.']),
  w('her', 'adverb', 'here', ['over here'], 'A2', ['Komm mal [[her]]!', 'Come [[here]]!'], 'Movement towards the speaker; hin = away from the speaker.'),
  w('andere', 'pronoun', 'other', ['others', 'different'], 'A1', ['Die [[anderen]] sind schon weg.', 'The [[others]] have already left.']),
  v('helfen', 'to help', [], 'A1', 'helfe,hilfst,hilft,helfen,helft,helfen', 'half,halfst,half,halfen,halft,halfen', 'hat geholfen', ['Kannst du mir [[helfen]]?', 'Can you [[help]] me?'], { governs: 'dative', note: 'Takes the dative: Ich helfe dir.' }),
  n('Nacht', 'feminine', 'die Nächte', 'der Nacht', 'night', [], 'A1', ['Gute [[Nacht]]!', 'Good [[night]]!']),
  v('finden', 'to find', ['to think'], 'A1', 'finde,findest,findet,finden,findet,finden', 'fand,fandest,fand,fanden,fandet,fanden', 'hat gefunden', ['Ich [[finde]] meinen Schlüssel nicht.', 'I can’t [[find]] my key.'], { note: 'Also an opinion: Ich finde das gut = I think that’s good.' }),
  w('lange', 'adverb', 'long', ['for a long time'], 'A1', ['Wir warten schon [[lange]].', 'We have been waiting [[a long time]].']),
  w('natürlich', 'adverb', 'of course', ['naturally'], 'A1', ['[[Natürlich]] helfe ich dir.', '[[Of course]] I’ll help you.']),
  w('gar', 'adverb', 'at all', ['even'], 'A2', ['Das ist [[gar]] nicht schwer.', 'That isn’t hard [[at all]].'], 'Mostly in gar nicht, gar nichts, gar kein.'),
  w('dort', 'adverb', 'there', ['over there'], 'A1', ['[[Dort]] drüben ist der Bahnhof.', 'The station is over [[there]].']),
  w('weiter', 'adverb', 'further', ['on', 'farther'], 'A2', ['Lies bitte [[weiter]].', 'Please read [[on]].'], 'With verbs: continue doing (weitermachen, weiterlesen).'),
  p('seit', 'dative', 'since', ['for'], 'A1', ['Ich lerne [[seit]] einem Jahr Deutsch.', 'I have been learning German [[for]] a year.'], 'With the present tense: Ich wohne seit 2020 hier = I have lived here since 2020.'),
  w('gleich', 'adverb', 'right away', ['immediately', 'same'], 'A1', ['Ich komme [[gleich]].', 'I’m coming [[right away]].'], 'As an adjective: the same (das gleiche Auto).'),
  n('Recht', 'neuter', 'die Rechte', 'des Rechts', 'right', ['law'], 'B1', ['Jeder hat das [[Recht]] auf Bildung.', 'Everyone has the [[right]] to education.'], 'recht haben = to be right.'),
  a('richtig', 'correct', ['right', 'real'], 'A1', ['Die Antwort ist [[richtig]].', 'The answer is [[correct]].']),
  n('Ordnung', 'feminine', 'die Ordnungen', 'der Ordnung', 'order', ['tidiness'], 'A2', ['Ist alles in [[Ordnung]]?', 'Is everything in [[order]]?'], 'In Ordnung! = All right! / OK.'),
  w('davon', 'adverb', 'of it', ['from it', 'about it'], 'A2', ['Ich habe [[davon]] gehört.', 'I have heard [[of it]].']),

  // ---- ranks 151-170 (Haus and essen are in fake.ts) ----
  w('dafür', 'adverb', 'for it', ['for that', 'in return'], 'A2', ['Danke [[dafür]]!', 'Thanks [[for that]]!']),
  p('wegen', 'genitive', 'because of', ['due to'], 'A2', ['[[Wegen]] des Regens bleiben wir zu Hause.', '[[Because of]] the rain we’re staying at home.'], 'In spoken German often with the dative: wegen dem Regen.'),
  n('Mädchen', 'neuter', 'die Mädchen', 'des Mädchens', 'girl', [], 'A1', ['Das [[Mädchen]] spielt Klavier.', 'The [[girl]] plays the piano.'], 'Neuter because of the ending -chen.'),
  w('hin', 'adverb', 'there', [], 'A2', ['Wir fahren morgen [[hin]].', 'We are going [[there]] tomorrow.'], 'Movement away from the speaker; her = towards the speaker.'),
  n('Abend', 'masculine', 'die Abende', 'des Abends', 'evening', [], 'A1', ['Guten [[Abend]]!', 'Good [[evening]]!']),
  w('drei', 'numeral', 'three', [], 'A1', ['Wir haben [[drei]] Kinder.', 'We have [[three]] children.']),
  n('Freund', 'masculine', 'die Freunde', 'des Freundes', 'friend', ['boyfriend'], 'A1', ['Mein [[Freund]] wohnt in München.', 'My [[friend]] lives in Munich.'], 'A female friend is die Freundin.'),
  v('warten', 'to wait', [], 'A1', 'warte,wartest,wartet,warten,wartet,warten', 'wartete,wartetest,wartete,warteten,wartetet,warteten', 'hat gewartet', ['Ich [[warte]] auf den Bus.', 'I am [[waiting]] for the bus.'], { note: 'warten auf + accusative = to wait for.' }),
  n('Mensch', 'masculine', 'die Menschen', 'des Menschen', 'person', ['human being', 'human'], 'A1', ['Sie ist ein sehr netter [[Mensch]].', 'She is a very nice [[person]].'], 'Weak noun: den, dem, des Menschen.'),
  n('Angst', 'feminine', 'die Ängste', 'der Angst', 'fear', ['anxiety'], 'A2', ['Ich habe [[Angst]] vor großen Hunden.', 'I have a [[fear]] of big dogs.'], 'Angst haben vor + dative = to be afraid of.'),
  v('bleiben', 'to stay', ['to remain'], 'A1', 'bleibe,bleibst,bleibt,bleiben,bleibt,bleiben', 'blieb,bliebst,blieb,blieben,bliebt,blieben', 'ist geblieben', ['Ich [[bleibe]] heute zu Hause.', 'I am [[staying]] at home today.']),
  w('zusammen', 'adverb', 'together', [], 'A1', ['Wir kochen heute [[zusammen]].', 'We are cooking [[together]] today.']),
  n('Welt', 'feminine', 'die Welten', 'der Welt', 'world', [], 'A2', ['Die [[Welt]] ist klein!', 'It’s a small [[world]]!']),
  p('unter', 'accusative or dative', 'under', ['below', 'among'], 'A1', ['Die Katze schläft [[unter]] dem Bett.', 'The cat is sleeping [[under]] the bed.'], 'Dative for position, accusative for movement.'),
  a('schnell', 'fast', ['quick', 'quickly'], 'A1', ['Der Zug ist sehr [[schnell]].', 'The train is very [[fast]].']),
  a('tot', 'dead', [], 'A2', ['Die Pflanze ist leider [[tot]].', 'Unfortunately the plant is [[dead]].']),
  v('dürfen', 'may', ['to be allowed to'], 'A1', 'darf,darfst,darf,dürfen,dürft,dürfen', 'durfte,durftest,durfte,durften,durftet,durften', 'hat gedurft', ['[[Darf]] ich hier sitzen?', '[[May]] I sit here?'], { note: MODAL }),
  w('erst', 'adverb', 'only', ['first', 'not until'], 'A2', ['Ich bin [[erst]] seit zwei Tagen hier.', 'I have [[only]] been here for two days.'], 'Of time: erst um zehn = not until ten.'),

  // ---- common words a learner is likely to type ----
  v('trinken', 'to drink', [], 'A1', 'trinke,trinkst,trinkt,trinken,trinkt,trinken', 'trank,trankst,trank,tranken,trankt,tranken', 'hat getrunken', ['Ich [[trinke]] morgens einen Tee.', 'I [[drink]] a tea in the morning.']),
  v('sprechen', 'to speak', ['to talk'], 'A1', 'spreche,sprichst,spricht,sprechen,sprecht,sprechen', 'sprach,sprachst,sprach,sprachen,spracht,sprachen', 'hat gesprochen', ['[[Sprichst]] du Deutsch?', 'Do you [[speak]] German?']),
  a('klein', 'small', ['little', 'short'], 'A1', ['Unsere Wohnung ist ziemlich [[klein]].', 'Our flat is quite [[small]].']),
  v('arbeiten', 'to work', [], 'A1', 'arbeite,arbeitest,arbeitet,arbeiten,arbeitet,arbeiten', 'arbeitete,arbeitetest,arbeitete,arbeiteten,arbeitetet,arbeiteten', 'hat gearbeitet', ['Sie [[arbeitet]] in einem Krankenhaus.', 'She [[works]] in a hospital.']),
  n('Buch', 'neuter', 'die Bücher', 'des Buches', 'book', [], 'A1', ['Ich lese gerade ein spannendes [[Buch]].', 'I’m reading an exciting [[book]] at the moment.']),
  n('Tisch', 'masculine', 'die Tische', 'des Tisches', 'table', ['desk'], 'A1', ['Das Essen steht schon auf dem [[Tisch]].', 'The food is already on the [[table]].']),
  n('Stadt', 'feminine', 'die Städte', 'der Stadt', 'city', ['town'], 'A1', ['Berlin ist eine große [[Stadt]].', 'Berlin is a big [[city]].']),
  n('Jahr', 'neuter', 'die Jahre', 'des Jahres', 'year', [], 'A1', ['Das [[Jahr]] hat zwölf Monate.', 'The [[year]] has twelve months.']),
  n('Kind', 'neuter', 'die Kinder', 'des Kindes', 'child', ['kid'], 'A1', ['Das [[Kind]] spielt im Garten.', 'The [[child]] is playing in the garden.']),
  n('Schule', 'feminine', 'die Schulen', 'der Schule', 'school', [], 'A1', ['Die [[Schule]] beginnt um acht Uhr.', '[[School]] starts at eight o’clock.']),
  n('Auto', 'neuter', 'die Autos', 'des Autos', 'car', [], 'A1', ['Unser [[Auto]] ist rot.', 'Our [[car]] is red.']),
  n('Brot', 'neuter', 'die Brote', 'des Brotes', 'bread', ['loaf'], 'A1', ['Ich kaufe frisches [[Brot]].', 'I’m buying fresh [[bread]].']),
  n('Kaffee', 'masculine', 'die Kaffees', 'des Kaffees', 'coffee', [], 'A1', ['Ich trinke morgens einen [[Kaffee]].', 'I drink a [[coffee]] in the morning.']),
  v('lesen', 'to read', [], 'A1', 'lese,liest,liest,lesen,lest,lesen', 'las,lasest,las,lasen,last,lasen', 'hat gelesen', ['Er [[liest]] jeden Morgen die Zeitung.', 'He [[reads]] the newspaper every morning.']),
  v('schreiben', 'to write', [], 'A1', 'schreibe,schreibst,schreibt,schreiben,schreibt,schreiben', 'schrieb,schriebst,schrieb,schrieben,schriebt,schrieben', 'hat geschrieben', ['Ich [[schreibe]] meiner Oma einen Brief.', 'I am [[writing]] my grandma a letter.']),
  v('schlafen', 'to sleep', [], 'A1', 'schlafe,schläfst,schläft,schlafen,schlaft,schlafen', 'schlief,schliefst,schlief,schliefen,schlieft,schliefen', 'hat geschlafen', ['Das Baby [[schläft]] noch.', 'The baby is still [[sleeping]].']),
  v('wohnen', 'to live', ['to reside'], 'A1', 'wohne,wohnst,wohnt,wohnen,wohnt,wohnen', 'wohnte,wohntest,wohnte,wohnten,wohntet,wohnten', 'hat gewohnt', ['Wo [[wohnst]] du?', 'Where do you [[live]]?'], { note: 'To live somewhere; leben = to be alive, to live.' }),
  v('kaufen', 'to buy', [], 'A1', 'kaufe,kaufst,kauft,kaufen,kauft,kaufen', 'kaufte,kauftest,kaufte,kauften,kauftet,kauften', 'hat gekauft', ['Wir [[kaufen]] ein neues Sofa.', 'We are [[buying]] a new sofa.']),
  a('neu', 'new', [], 'A1', ['Ist dein Handy [[neu]]?', 'Is your phone [[new]]?']),
  a('alt', 'old', [], 'A1', ['Wie [[alt]] bist du?', 'How [[old]] are you?'], 'älter', 'am ältesten'),
  n('Woche', 'feminine', 'die Wochen', 'der Woche', 'week', [], 'A1', ['Nächste [[Woche]] habe ich Urlaub.', 'Next [[week]] I’m on holiday.']),
  n('Straße', 'feminine', 'die Straßen', 'der Straße', 'street', ['road'], 'A1', ['Wir wohnen in einer ruhigen [[Straße]].', 'We live on a quiet [[street]].']),
  n('Zug', 'masculine', 'die Züge', 'des Zuges', 'train', [], 'A1', ['Der [[Zug]] hat zehn Minuten Verspätung.', 'The [[train]] is ten minutes late.']),
  v('spielen', 'to play', [], 'A1', 'spiele,spielst,spielt,spielen,spielt,spielen', 'spielte,spieltest,spielte,spielten,spieltet,spielten', 'hat gespielt', ['Die Kinder [[spielen]] im Park.', 'The children are [[playing]] in the park.']),
  v('fahren', 'to drive', ['to go', 'to travel', 'to ride'], 'A1', 'fahre,fährst,fährt,fahren,fahrt,fahren', 'fuhr,fuhrst,fuhr,fuhren,fuhrt,fuhren', 'ist gefahren', ['Wir [[fahren]] mit dem Zug nach Wien.', 'We are [[going]] to Vienna by train.'], { note: 'Perfekt with sein; with a direct object (ein Auto fahren) with haben.' }),
  v('lernen', 'to learn', ['to study'], 'A1', 'lerne,lernst,lernt,lernen,lernt,lernen', 'lernte,lerntest,lernte,lernten,lerntet,lernten', 'hat gelernt', ['Ich [[lerne]] jeden Tag Deutsch.', 'I [[learn]] German every day.']),
  v('verstehen', 'to understand', [], 'A1', 'verstehe,verstehst,versteht,verstehen,versteht,verstehen', 'verstand,verstandest,verstand,verstanden,verstandet,verstanden', 'hat verstanden', ['Ich [[verstehe]] das nicht.', 'I don’t [[understand]] that.']),
  n('Familie', 'feminine', 'die Familien', 'der Familie', 'family', [], 'A1', ['Meine [[Familie]] wohnt in Wien.', 'My [[family]] lives in Vienna.']),
  n('Bruder', 'masculine', 'die Brüder', 'des Bruders', 'brother', [], 'A1', ['Mein [[Bruder]] ist älter als ich.', 'My [[brother]] is older than me.']),
  n('Schwester', 'feminine', 'die Schwestern', 'der Schwester', 'sister', [], 'A1', ['Meine [[Schwester]] studiert Medizin.', 'My [[sister]] studies medicine.']),
  v('aufstehen', 'to get up', ['to stand up'], 'A1', 'stehe auf,stehst auf,steht auf,stehen auf,steht auf,stehen auf', 'stand auf,standest auf,stand auf,standen auf,standet auf,standen auf', 'ist aufgestanden', ['Ich [[stehe]] jeden Tag um sieben Uhr [[auf]].', 'I [[get up]] at seven o’clock every day.'], { separable: true }),
  v('sich freuen', 'to be glad', ['to be happy', 'to look forward to'], 'A2', 'freue mich,freust dich,freut sich,freuen uns,freut euch,freuen sich', 'freute mich,freutest dich,freute sich,freuten uns,freutet euch,freuten sich', 'hat sich gefreut', ['Ich [[freue mich]] auf das Wochenende.', 'I’m [[looking forward]] to the weekend.'], { reflexive: true, note: 'sich freuen auf + accusative = to look forward to; sich freuen über + accusative = to be happy about.' }),
  n('Apfel', 'masculine', 'die Äpfel', 'des Apfels', 'apple', [], 'A1', ['Ich esse jeden Tag einen [[Apfel]].', 'I eat an [[apple]] every day.']),
  n('Milch', 'feminine', null, 'der Milch', 'milk', [], 'A1', ['Nimmst du [[Milch]] in den Kaffee?', 'Do you take [[milk]] in your coffee?'], 'No plural in everyday use.'),
  n('Arbeit', 'feminine', 'die Arbeiten', 'der Arbeit', 'work', ['job'], 'A1', ['Ich fahre mit dem Rad zur [[Arbeit]].', 'I cycle to [[work]].']),
  n('Uhr', 'feminine', 'die Uhren', 'der Uhr', 'clock', ['watch', 'o’clock'], 'A1', ['Meine [[Uhr]] ist kaputt.', 'My [[watch]] is broken.'], 'Times: Es ist acht Uhr = It is eight o’clock.'),
]
