# Languages

Add a language in three steps:

1. Copy `locales/en.js` to `locales/<code>.js` and translate the values. Keep the keys and the `{name}` placeholders. A missing key shows the English text.
2. In `langs.js`, import it and add one line to `LANGS` (`name` in its own script, `dir` of `ltr` or `rtl`).
3. For a right-to-left language the layout flips by itself (`<html dir>`); extra fixes go in `app/rtl.css`. For a new script, add its font in `app/layout.js` and a `html[lang='<code>']` rule setting `--sans`.

Use in code:

- Browser components: `const t = useT();` from `@/components/I18nProvider`, then `t('settings.language')`.
- Server components: `const t = await getT();` from `@/lib/i18n/server`.
- The language is the `opus-lang` cookie. `useLang().setLang('fa')` saves it and reloads.

`npm test` checks that no language has a key English lacks and that placeholders match.
