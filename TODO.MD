# Feature Ideas
- [ ] Review Transactions Minor Experience Enhancements –> Uncategorized filter (if user clicks on the chip they can filter to only un categorized)
- [ ] Review Transactions Minor UI bug fix -> drop down does not overflow out of the parent container.
- [ ] Inline Transaction UX quality of life – Enter should commit inline changes on a transaction line. also open to other useful keyboard shortcuts like ESC to exit edit mode.
- [ ] Inline Transaction UX quality of life - Set recurring inline
- [ ] Transaction line dragging between categories?
- [ ] I wanna brainstorm full overhaul of the inline transaction data input and managment.
- [ ] If a recurring transaction/line is in the past it should automatically be set to confirmed (e.g. I put a salary that started being made to me a few years back it should be confirmed. Future should be planned) 
- [ ] Utility bills are recurring, but fluctuate, need to be able to set them with an open (same as last month? forcasted pre set value?) and be notified to add them via banner or something to update their value when the invoice is made.
- [ ] Standardize the allowed edits between "Add new" and "Edit" transaction line. I want users to be able to adjust all parameters after the fact (as long as not database/logic breaking which i dont think any should be; in such a case there needs to be a tooltip or transparancy to the user as to why that may be)
- [ ] After a few times using the Anthropic API to scan docs on a downloaded version of the PWA, app gives a No API Credits message -> We get a 403 and the error claims i dont have cash in my API account but I have confirmed that there is and that my API Key is healthy, I think we're hitting ratelimits by cloudflare or anthropic not sure. Lets add a turnstile protection on the app so that we clear out bots.
- [ ] Study if Turnstile is worthwhile for our app usecase?
- [x] A mechanism to announce to users our changelog
- [x] LLM SDK Agnostic approach. Users can input OpenAI, Anthropic, Gemini Keys and use any model they like.
- [x] Zakat calculator function (including all assets that are zakatable like stocks, gold, cash and other commodoties)
- [ ] Clean up the categories UI
- [x] Indicate to user that by using the LLM bank statement import that they will be sharing their data with the LLM company.
- [x] Explore how to use cloudflare ai workers to spin up an open source model to do the processing instead of having users put their API keys (Configurable option for the user)
- [x] Basic and detailed overview pages -> Create a new tab in the overview page which houses a basic more chart and KPI Box (w/ trends) based overview This should be the default and then users can view the detailed view should they wish via tab – tab setting should be remembered.
- [x] Enhance mobile experience
- [x] Address no whatsapp redirects not working.


---

# Cactus v3.0
Paid cloud sync feature (Try to make it as secure and private as possible and since app is open source we can guide users to self host and setup)
- [ ] Setup optional auth
- [ ] Setup email that receives forwarded bank transaction emails from users and updates their profile
- [ ] Setup Cactus Budgets -> Budget setting and tracking, takes users through a journey where they set a few pre-requistites and set their budget per category and then track via forwarded bank emails.
- [ ] Enhance category management and setup experience
- [ ] Allow users to customize what appears on their nav bar (maybe a user does not want to see the Zaka functionality)
- [ ] ?Fine tuned QWEN model for transaction categorization?
- [ ] ?Stock Porfolio connect? Interactive brokers integration, Schwab Integration?
- [ ] Persistent DB setup -> User can choose to hook up their own supabase database or even locally hosted postgres DB such that they can have their data shared across devices (This may need Auth setup) – I need to study how best to approach this.
