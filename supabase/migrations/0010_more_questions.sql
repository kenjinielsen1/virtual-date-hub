-- =============================================================================
-- Bigger question bank for Trivia (would-you-rather + how-well) and
-- Never Have I Ever. Paste into the Supabase SQL editor and run.
-- Each block is guarded by a sentinel row, so re-running won't duplicate.
-- =============================================================================

-- ---- More "would you rather" -------------------------------------------------
insert into public.prompts (category, text, option_a, option_b)
select 'would_you_rather', 'Would you rather...', a, b from (values
  ('Have a cozy night in with takeout', 'Go out to a fancy restaurant'),
  ('Spend a rainy day in bed', 'Spend a sunny day at the park'),
  ('Win a dream vacation for two', 'Win our dream home'),
  ('Relive our best day together', 'Peek one year into our future'),
  ('Always cuddle to sleep', 'Have the whole bed to sprawl'),
  ('Text all day', 'Have one long phone call at night'),
  ('Grow old in a big city', 'Grow old in the quiet countryside'),
  ('Take a couples cooking class', 'Take a couples dance class'),
  ('Be surprised with flowers', 'Be surprised with a handwritten letter'),
  ('Have one big adventure a year', 'Have lots of tiny getaways'),
  ('Teleport to each other anytime', 'Never have to say goodbye at airports'),
  ('Have a home library', 'Have a home movie theater'),
  ('Go stargazing together', 'Watch the sunrise together'),
  ('Have a garden together', 'Have a big cozy kitchen'),
  ('Dance in the rain', 'Build a blanket fort'),
  ('Take a food trip through Italy', 'Take a beach trip through Thailand'),
  ('Have a song that is ours', 'Have a place that is ours'),
  ('Relive our first kiss', 'Relive our first I love you'),
  ('Spend a day with no phones', 'Spend a day with no plans'),
  ('Have a weekly date night', 'Have a monthly weekend away'),
  ('Get a couples massage', 'Take a couples pottery class'),
  ('Have a treehouse', 'Have a lake cabin'),
  ('Road-trip with a great playlist', 'Road-trip with great snacks'),
  ('Fall asleep on a call', 'Wake up to a good-morning text'),
  ('Have a picnic under the stars', 'Have brunch on a balcony'),
  ('Learn each other''s language', 'Learn to cook each other''s favorite dish'),
  ('Spend the holidays traveling', 'Spend the holidays cozy at home'),
  ('Have a signature drink we make', 'Have a signature meal we cook'),
  ('Get caught in the rain together', 'Get snowed in together'),
  ('Have front-row concert tickets', 'Have a private acoustic set at home'),
  ('Always share dessert', 'Always order your own'),
  ('Plan a surprise for me', 'Be surprised by me'),
  ('Have a lifetime of Sunday mornings', 'Have a lifetime of Friday nights'),
  ('Renew our vows on a beach', 'Renew our vows in a forest'),
  ('Have a jar of date ideas', 'Have a jar of reasons we love each other'),
  ('Slow dance in the kitchen', 'Take long walks after dinner'),
  ('Have a cozy reading nook for two', 'Have a big comfy movie couch'),
  ('Travel the whole world together', 'Make one place feel like home'),
  ('Always finish each other''s sentences', 'Always surprise each other'),
  ('Have breakfast dates', 'Have late-night dates')
) as v(a, b)
where not exists (
  select 1 from public.prompts
  where category = 'would_you_rather'
    and option_a = 'Have a cozy night in with takeout'
);

-- ---- More "how well do you know me" -----------------------------------------
insert into public.prompts (category, text)
select 'how_well', t from (values
  ('What is my favorite way to relax after a long day?'),
  ('What is my go-to karaoke song?'),
  ('What is my dream vacation destination?'),
  ('What is my favorite season and why?'),
  ('What is my biggest guilty pleasure?'),
  ('What is my favorite dessert?'),
  ('What is my ideal breakfast?'),
  ('What is a talent I wish I had?'),
  ('What is my favorite scent?'),
  ('What is my favorite movie genre?'),
  ('What always cheers me up when I am down?'),
  ('What is my favorite childhood memory?'),
  ('What is my biggest dream in life?'),
  ('What is my love language?'),
  ('What is my favorite thing about you?'),
  ('What is my favorite holiday?'),
  ('What is my most treasured possession?'),
  ('What was my favorite subject in school?'),
  ('What is my drink of choice on a night out?'),
  ('What is my favorite pizza topping?'),
  ('What is a place I have always wanted to live?'),
  ('What is my hidden talent?'),
  ('What is my favorite animal?'),
  ('What is my go-to comfort movie?'),
  ('What is my biggest hope for the future?'),
  ('What is something I am secretly proud of?'),
  ('What is my favorite time of day?'),
  ('What is my ideal date night?'),
  ('What is a song that always makes me dance?'),
  ('What is my most-used app?'),
  ('What is my favorite home-cooked meal?'),
  ('What color do I wear the most?'),
  ('What would my perfect weekend look like?'),
  ('What is my favorite thing we have done together?'),
  ('What did I want to be when I grew up?'),
  ('What is my favorite book or story?'),
  ('What makes me laugh the hardest?'),
  ('What is my favorite thing to do outdoors?'),
  ('What is a habit I am trying to build?'),
  ('What is my idea of a perfect gift?')
) as v(t)
where not exists (
  select 1 from public.prompts
  where category = 'how_well'
    and text = 'What is my favorite way to relax after a long day?'
);

-- ---- More "never have I ever" -----------------------------------------------
insert into public.prompts (category, text)
select 'never_have_i_ever', t from (values
  ('talked about you to my family'),
  ('lost track of time on a call with you'),
  ('gotten butterflies seeing your name pop up'),
  ('planned our future in my head'),
  ('picked a song for you to hear'),
  ('fallen for you a little more than yesterday'),
  ('saved a screenshot of something you said'),
  ('teared up over a text from you'),
  ('imagined introducing you to my friends'),
  ('rehearsed telling you something important'),
  ('checked my phone hoping you texted'),
  ('smiled thinking about our first date'),
  ('gotten shy around you'),
  ('made a playlist that reminds me of you'),
  ('looked up flights to see you'),
  ('counted the hours until we would talk'),
  ('worn something because you would like it'),
  ('told a friend you might be the one'),
  ('cooked something because you mentioned it'),
  ('learned something new to share with you'),
  ('saved a date in my calendar for us'),
  ('wanted to freeze a moment with you'),
  ('gotten teased about how much I talk about you'),
  ('felt lucky just to know you'),
  ('sent the good-morning text first'),
  ('planned a surprise for you'),
  ('watched something because you love it'),
  ('memorized your coffee order'),
  ('felt at home in a video call'),
  ('wished a goodbye could wait'),
  ('replayed a compliment you gave me'),
  ('imagined slow dancing with you'),
  ('told you something I have never told anyone'),
  ('felt truly seen by you'),
  ('laughed until I cried with you'),
  ('made a wish about us'),
  ('looked at old photos of us on purpose'),
  ('planned a date I have not told you about yet'),
  ('felt proud to be yours'),
  ('gotten used to falling asleep to your voice'),
  ('fallen a little harder every time we talk'),
  ('kept a little thing that reminds me of you'),
  ('gotten nervous before seeing you'),
  ('felt homesick for a person, not a place'),
  ('daydreamed about a trip together'),
  ('reread our very first messages'),
  ('practiced a joke to make you laugh'),
  ('imagined our home together'),
  ('counted down to a reunion'),
  ('picked our song')
) as v(t)
where not exists (
  select 1 from public.prompts
  where category = 'never_have_i_ever'
    and text = 'talked about you to my family'
);
