// Prices are illustrative Australian cents. Wear coordinates locate the example mark
// on a plain, face-on inspection diagram independently of the angled product artwork.
const products = [
  {
    id: 'nigi', name: 'Neegy', category: 'Accessories', format: 'Collectible', cents: 1200,
    quantity: 1, image: '/shop/art/nigi.png', collection: 'recently-added',
    description: 'Neegy', notes: ''
  },
  {
    id: 'tide-pack', name: 'Tide Pool', category: 'Packs', format: 'Illustrated booster pack', cents: 850,
    description: 'Lemrix takes a dip. A little blue daydream, wrapped up like a pack you’re about to crack.',
    notes: 'Deep-blue foil, cream lettering and bands of turquoise surf frame the mascot.'
  },
  {
    id: 'signal-pack', name: 'Signal', category: 'Packs', format: 'Illustrated booster pack', cents: 950,
    description: 'One more pack before the stream ends. This wrapper borrows its colours and attitude from the TV scene.',
    notes: 'Red foil and gold broadcast rings frame a tiny CRT, with Lemrix tucked inside the screen.'
  },
  {
    id: 'daybreak-card', name: 'Daybreak', category: 'Singles', format: 'Lemrix art card',
    description: 'A quiet morning with Lemrix, framed as a single collectible art card.',
    notes: 'A golden sunrise, a patch of daisies and a clear card case frame this half of the day-and-night pair.',
    copies: [
      { condition: 'Near mint', cents: 2450, front: ['Clean face and corners.'], back: ['One tiny white fleck on the lower-right edge.', 96, 88] },
      { condition: 'Lightly played', cents: 1800, front: ['Faint surface line near the lower border.', 44, 82], back: ['Light whitening at the upper-left corner.', 5, 5] },
      { condition: 'Moderately played', cents: 1250, front: ['A short scuff just above the lower-left border.', 19, 79], back: ['Visible whitening along the bottom edge.', 50, 96] }
    ]
  },
  {
    id: 'night-card', name: 'After Hours', category: 'Singles', format: 'Lemrix art card',
    description: 'The lights are low, the stream is over, and Lemrix is still up. The evening companion to Daybreak.',
    notes: 'A crescent moon and a violet night sky sit behind Lemrix, the evening opposite of the Daybreak card.',
    copies: [
      { condition: 'Near mint', cents: 2900, front: ['Clean artwork and border.'], back: ['A single pinprick at the top edge.', 57, 4] },
      { condition: 'Lightly played', cents: 2150, front: ['A shallow hairline near the left edge.', 13, 42], back: ['Two small white flecks at the bottom-left corner.', 5, 95] }
    ]
  },
  {
    id: 'cloud-sleeves', name: 'Cloud Cover', category: 'Accessories', format: 'Illustrated card sleeves', cents: 1550,
    description: 'A bit of blue sky for the back of your deck. A sleeve design featuring Lemrix.',
    notes: 'A cloud border and dark-blue corners carry the design right to the edges of the sleeve.'
  },
  {
    id: 'field-box', name: 'Field Kit', category: 'Accessories', format: 'Illustrated deck box', cents: 3200,
    description: 'Lemrix packs up for a day out. A deck-box study inspired by his little patch of grass.',
    notes: 'Deep green panels, gold lettering and warm stitched edges bring the hillside colours onto a deck box.'
  },
  {
    id: 'soft-landing', name: 'Soft Landing', category: 'Singles', format: 'Lemrix art card', collection: 'recently-added',
    description: 'The hill has other plans. Lemrix takes the scenic route down, feet first through an apricot sky.',
    notes: 'Soft Landing freezes the opening fall on a card, with wind curling through the sky above his hill.',
    copies: [
      { condition: 'Near mint', cents: 2750, front: ['Clear surface with sharp corners.'], back: ['A tiny fleck at the top-right corner.', 95, 5] },
      { condition: 'Lightly played', cents: 2050, front: ['A short print-line scuff near the right border.', 86, 37], back: ['Light edge whitening near the lower left.', 19, 96] }
    ]
  },
  {
    id: 'last-showing', name: 'Last Showing', category: 'Singles', format: 'Lemrix art card', collection: 'recently-added',
    description: 'The screen is warm, the popcorn is full and Lemrix has found the best seat in the house.',
    notes: 'This cinema illustration borrows its little television and popcorn bucket from the stream scene.',
    copies: [
      { condition: 'Near mint', cents: 3150, front: ['A clean face with an even border.'], back: ['One small dot on the left edge.', 4, 57] },
      { condition: 'Lightly played', cents: 2300, front: ['A faint rub at the lower-right corner.', 94, 94], back: ['A pale scuff close to the upper border.', 68, 14] }
    ]
  },
  {
    id: 'moon-run', name: 'Moon Run', category: 'Singles', format: 'Lemrix art card', collection: 'pre-orders',
    description: 'Midnight on the hill. A streak of blue slips past the moon before the rest of the world wakes up.',
    notes: 'A moonlit running pose and a deep teal palette carry the motion across this card.',
    copies: [
      { condition: 'Near mint', cents: 3400, front: ['Clear face and borders on this example.'], back: ['No visible marks on this example.'] },
      { condition: 'Lightly played', cents: 2550, front: ['A fine rub inside the upper-right border.', 88, 14], back: ['A little whitening at the lower-left corner.', 5, 96] }
    ]
  },
  {
    id: 'first-light', name: 'First Light', category: 'Packs', format: 'Illustrated booster pack', cents: 1150, collection: 'pre-orders',
    description: 'Before the first pack break, there’s one last nap. A sunny wrapper for Lemrix’s slowest morning.',
    notes: 'Turquoise details and warm gold foil echo the first light on the grassy mound.'
  }
];
