# Watermelon UI reference

Pulled verbatim from the shadcn-format registry at https://ui.watermelon.sh/registry.json
(778 components; `@watermelon-ui/cli` is not on npm yet, so these came straight from the JSON).

They are kept here as reference, outside `src/`, so they are not type-checked or bundled.
The app adapts their motion patterns rather than importing them, because each ships its own
palette and hardcoded demo props:

| Reference            | Adapted into           | What was taken                                    |
|----------------------|------------------------|---------------------------------------------------|
| `fluid-tabs`         | `src/components/Tabs`  | `layoutId` pill + blur-through-swap on the label   |
| `inline-toast`       | `src/components/Toast` | spring entry, blur morph, timer bar wipe           |
| `copy-confirm`       | `src/components/Bits`  | icon/label cross-fade into a checkmark            |
| `labeled-progress-…` | `src/components/Bits`  | travelling sheen over the progress fill            |
| `list-stack`         | `src/components/ActionItems` | staggered list entry                        |

To pull more: `curl -s https://ui.watermelon.sh/registry.json | jq '.items[] | select(.name=="NAME")'`
