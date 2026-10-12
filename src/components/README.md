# components

Presentational UI pieces from DESIGN-SPEC §2, one folder each:

```
<Name>/<Name>.tsx          typed props, no global state
<Name>/<Name>.module.css   tokens from src/styles/tokens.css only
<Name>/<Name>.stories.tsx  one Ladle story per variant and state
<Name>/<Name>.test.tsx     behaviour, keyboard, axe
```

Re-export each from `index.ts`. Components never fetch, parse or touch three.js; they receive data and
report events through props.
