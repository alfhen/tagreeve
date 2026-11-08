## plan

I'll run Tagreeve as a visitor who sees the cookie banner but never answers it, and check what's sent while they're undecided.

## verdict

5 hits before consent

Meta and Google Ads fire while the banner is still open.

## reply

Legal is right. While the banner is still open, two marketing tags already fire: Meta PageView and Google Ads (5 hits, all before any answer).

GA4 behaves: it sends page_view with consent denied, as it should.

Evidence: hit_…J3A2, hit_…8RHN, hit_…8RHS, hit_…4328, hit_…4329. Most likely a Meta and an Ads tag on All Pages without a consent check.
