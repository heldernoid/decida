// Inbox: 100 hand-written emails, 75 legitimate and 25 spam (a fixed, known split), sorted in one batched request.
// Every email is one yes/no question ("is this spam?"); read one to see the reading pane's own rule (independent of
// the model): no link in this bench is ever a real, clickable hyperlink, benign-looking or not — a domain that is
// safe today can be abandoned and bought by someone else tomorrow, so nothing here is worth the risk of a click.
// Pure logic, no DOM: runs in the browser and under node.

export const TOTAL = 100;
export const SPAM_COUNT = 25;

// Known shortener/redirect domains and other patterns a mail client itself would flag, regardless of content.
const SHORTENERS = ['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'cutt.ly', 'rebrand.ly'];
const IP_HOST = /^\d{1,3}(\.\d{1,3}){3}/;
const LOOKALIKE = /-(secure|verify|update|confirm|account|login)\d*\.(?!com\b)/i; // e.g. paypal-secure.tk

// Every href below is stored already defanged (defang(), further down), so nothing in this file is ever a live,
// scheme-prefixed URL. The host is read straight out of that shape with plain string splitting: no URL object, no
// scheme ever put back together.
export function hostOf(url) {
  const host = String(url).replace(/^httpzs?\[:\]\/\//i, '').split('/')[0].replace(/\[\.\]/g, '.');
  return host.replace(/^www\./, '');
}

// Displayed, never clickable, and never stored as a live value either: the scheme and every dot are broken up the
// way security write-ups defang a URL, so pasting, auto-linking or scanning it can never treat it as a real address.
export function defang(url) {
  return String(url).replace(/^(https?):\/\//i, (_, s) => `${s.toLowerCase() === 'https' ? 'httpzs' : 'httpz'}[:]//`).replace(/\./g, '[.]');
}

// A link is suspicious by its own shape, not by whether the email is spam: a real mail client cannot know the
// verdict in advance, so this only looks at the URL and the text shown for it.
export function suspiciousLink(href, text = '') {
  const host = hostOf(href);
  if (SHORTENERS.includes(host)) return 'shortened link hides the real address';
  if (IP_HOST.test(host)) return 'links straight to a numeric address';
  if (LOOKALIKE.test(host)) return 'domain name imitates a real company';
  const bare = text.trim().split('/')[0].replace(/^www\./, '');
  const textHost = /^[\w-]+(\.[\w-]+)+$/.test(bare) ? bare : null; // the text itself reads as a bare domain (± a path)
  if (textHost && textHost !== host) return `text says "${textHost}" but the link goes to ${host}`;
  return null;
}

const L = (href, text) => ({ href, text });

// id, from, subject, snippet (what the list shows), body (what opening it shows), links, spam (ground truth).
export const EMAILS = [
  // --- legitimate: work (10) ---
  { from: 'Priya Nair <priya.nair@acmecorp.com>', subject: 'Q3 planning doc for review', snippet: 'Could you take a look before Thursday’s meeting?', body: 'Hi team, I’ve put together the Q3 planning doc. Could you take a look before Thursday’s meeting and leave comments inline? Thanks, Priya', spam: false },
  { from: 'IT Helpdesk <helpdesk@acmecorp.com>', subject: 'Scheduled maintenance tonight 11pm-1am', snippet: 'VPN and email will be briefly unavailable.', body: 'The VPN and internal email will be briefly unavailable tonight between 11pm and 1am for scheduled maintenance. No action needed.', spam: false },
  { from: 'Calendly <notifications@calendly.com>', subject: 'New event: 1:1 with Jordan, Tue 2pm', snippet: 'Jordan Lee scheduled a 30 minute meeting with you.', body: 'Jordan Lee scheduled a 30 minute meeting with you for Tuesday at 2:00pm. Add to your calendar.', links: [L('httpzs[:]//calendly[.]com/events/9f2a', 'Add to calendar')], spam: false },
  { from: 'HR <hr@acmecorp.com>', subject: 'Open enrolment closes Friday', snippet: 'Make your benefits elections before the deadline.', body: 'Reminder: open enrolment for benefits closes this Friday at 5pm. Log in to the HR portal to make or confirm your elections.', spam: false },
  { from: 'GitHub <notifications@github.com>', subject: '[decida] New review requested', snippet: 'heldernoid requested your review on pull request #142.', body: 'heldernoid requested your review on pull request #142 in decida/decida. View the diff and leave comments.', links: [L('httpzs[:]//github[.]com/decida/decida/pull/142', 'View pull request')], spam: false },
  { from: 'Sam Torres <sam.torres@acmecorp.com>', subject: 'Lunch on Thursday?', snippet: 'A few of us are grabbing lunch, want to join?', body: 'A few of us are grabbing lunch on Thursday around noon, want to join? Let me know.', spam: false },
  { from: 'Payroll <payroll@acmecorp.com>', subject: 'Your November payslip is ready', snippet: 'Log in to the payroll portal to view it.', body: 'Your November payslip is now available. Log in to the payroll portal with your usual company credentials to view it.', spam: false },
  { from: 'Zoom <no-reply@zoom.us>', subject: 'Meeting recording ready: Sprint Review', snippet: 'The recording from your meeting is now available.', body: 'The recording from "Sprint Review" on Monday is now available in your Zoom account for the next 30 days.', links: [L('httpzs[:]//zoom[.]us/rec/share/xk2p', 'View recording')], spam: false },
  { from: 'Maria Chen <maria.chen@acmecorp.com>', subject: 'Notes from today’s standup', snippet: 'Summary and action items attached below.', body: 'Notes from today’s standup: backend migration is on track, frontend blocked on the new design tokens. Action items below.', spam: false },
  { from: 'LinkedIn <messages-noreply@linkedin.com>', subject: 'You have a new message from a former colleague', snippet: 'Open LinkedIn to read the full message.', body: 'You have a new message waiting on LinkedIn from someone you worked with previously.', links: [L('httpzs[:]//www[.]linkedin[.]com/messaging/', 'Read message')], spam: false },

  // --- legitimate: personal (10) ---
  { from: 'Mum <jean.miller@fastmail.com>', subject: 'Sunday lunch?', snippet: 'Your dad is doing his roast, come by around 1.', body: 'Your dad is doing his Sunday roast again, come by around 1 if you’re free. Bring the kids if you like.', spam: false },
  { from: 'Alex <alexdp90@gmail.com>', subject: 'Photos from the hike', snippet: 'Finally uploaded them, the view from the top was incredible.', body: 'Finally uploaded the photos from our hike last weekend, the view from the top was incredible. Link below.', links: [L('httpzs[:]//photos[.]app[.]goo[.]gl/x8k2', 'View album')], spam: false },
  { from: 'Nina <nina.osei@outlook.com>', subject: 'Happy birthday!!', snippet: 'Hope you have a wonderful day, let’s celebrate soon.', body: 'Happy birthday! Hope you have a wonderful day, let’s celebrate properly soon, I’ll call you this weekend.', spam: false },
  { from: 'Tom <tom.baker@gmail.com>', subject: 'Still on for Saturday?', snippet: 'Just checking the plan for Saturday still works.', body: 'Just checking the plan for Saturday still works for you, same time and place as last time?', spam: false },
  { from: 'Building Management <office@parkviewapts.com>', subject: 'Water shut-off notice, Wed 9am-noon', snippet: 'Routine maintenance to the building’s water supply.', body: 'The building’s water supply will be shut off Wednesday from 9am to noon for routine maintenance. We apologise for the inconvenience.', spam: false },
  { from: 'School Office <office@lincolnprimary.edu>', subject: 'Reminder: parent evening this Thursday', snippet: 'Slots are still available if you haven’t booked yet.', body: 'This is a reminder that parent evening is this Thursday from 4pm to 7pm. A few slots are still available if you haven’t booked yet.', spam: false },
  { from: 'Dana <dana.w@gmail.com>', subject: 'Recipe you asked about', snippet: 'Here’s the pasta recipe from dinner last night.', body: 'Here’s the pasta recipe from dinner last night, it’s really just garlic, chilli and good olive oil.', spam: false },
  { from: 'City Library <noreply@citylibrary.org>', subject: 'Your hold is ready for pickup', snippet: 'The book you reserved is waiting at the front desk.', body: 'The book you reserved is now ready for pickup at the front desk. It will be held for 7 days.', spam: false },
  { from: 'Coach Rick <rick@riversideclub.org>', subject: 'Practice moved to 6pm tomorrow', snippet: 'Field availability changed, same location.', body: 'Tomorrow’s practice has moved to 6pm because of a field booking clash. Same location, just the later time.', spam: false },
  { from: 'Grandpa <edward.hale@gmail.com>', subject: 'Fishing this weekend', snippet: 'Weather looks good, want to come out on the boat?', body: 'Weather looks good for the weekend, want to come out on the boat Saturday morning? Bring a jacket, it’ll be cold early.', spam: false },

  // --- legitimate: shopping/receipts (10) ---
  { from: 'Amazon <order-update@amazon.com>', subject: 'Your order has shipped', snippet: 'Order #112-4456789 is on its way.', body: 'Your order #112-4456789 has shipped and is expected to arrive Thursday. Track your package for live updates.', links: [L('httpzs[:]//www[.]amazon[.]com/gp/your-account/order-history', 'Track package')], spam: false },
  { from: 'Etsy <transaction@etsy.com>', subject: 'Your order is confirmed', snippet: 'Thanks for your purchase from Willow & Birch Ceramics.', body: 'Thanks for your purchase from Willow & Birch Ceramics. Your order is being prepared and will ship within 3 business days.', spam: false },
  { from: 'Target <ordersupport@target.com>', subject: 'Ready for pickup at Store #1142', snippet: 'Your order is ready, bring your ID and confirmation.', body: 'Your order is ready for pickup at Store #1142. Bring a photo ID and this confirmation to the guest service desk.', spam: false },
  { from: 'Uber Receipts <receipts@uber.com>', subject: 'Your Tuesday evening trip receipt', snippet: 'Total: $14.32. Thanks for riding with Uber.', body: 'Here is your receipt for the trip on Tuesday evening. Total: $14.32. Thanks for riding with Uber.', spam: false },
  { from: 'Spotify <no-reply@spotify.com>', subject: 'Your Premium receipt', snippet: 'Payment of $10.99 was processed successfully.', body: 'Your monthly Spotify Premium payment of $10.99 was processed successfully. Your next billing date is the 14th.', spam: false },
  { from: 'REI <orders@rei.com>', subject: 'Delivered: hiking boots', snippet: 'Your package was delivered to your front porch.', body: 'Your package containing hiking boots was delivered to your front porch this afternoon at 2:14pm.', spam: false },
  { from: 'Delta Air Lines <no-reply@delta.com>', subject: 'Check-in now open for flight DL1420', snippet: 'Check in online and choose your seat.', body: 'Online check-in is now open for your upcoming flight DL1420. Check in now to choose your seat and save time at the airport.', links: [L('httpzs[:]//www[.]delta[.]com/checkin', 'Check in now')], spam: false },
  { from: 'Steam <noreply@steampowered.com>', subject: 'Your purchase confirmation', snippet: 'Thanks for your purchase, the game is in your library.', body: 'Thanks for your purchase. The game has been added to your library and is ready to download.', spam: false },
  { from: 'Costco <receipts@costco.com>', subject: 'Digital receipt for your visit', snippet: 'Store #221, total $84.17.', body: 'Here is your digital receipt for your visit to Store #221. Total: $84.17. Thanks for shopping with us.', spam: false },
  { from: 'IKEA <no-reply@ikea.com>', subject: 'Your order is being prepared', snippet: 'We’ll email you again once it ships.', body: 'Your recent order is being prepared at our warehouse. We’ll email you again once it ships, usually within 2 business days.', spam: false },

  // --- legitimate: finance/bills (10) ---
  { from: 'City Power & Water <billing@citypw.gov>', subject: 'Your bill is ready: $86.40 due Oct 30', snippet: 'View and pay your bill online.', body: 'Your latest utility bill of $86.40 is ready and due on October 30th. Log in to your account on our official site to view or pay it.', spam: false },
  { from: 'Chase <alerts@chase.com>', subject: 'Statement is ready to view', snippet: 'Your October statement is now available online.', body: 'Your October credit card statement is now available. Log in to your account through the app or our website to view it.', spam: false },
  { from: 'Fidelity <notifications@fidelity.com>', subject: 'Quarterly statement available', snippet: 'Your retirement account statement is ready.', body: 'Your quarterly retirement account statement is now available in your secure message center.', spam: false },
  { from: 'State Farm <service@statefarm.com>', subject: 'Auto policy renewal notice', snippet: 'Your policy renews December 1st, no action needed.', body: 'Your auto insurance policy is set to renew on December 1st with no changes to your coverage. No action is needed unless you want to make changes.', spam: false },
  { from: 'Netflix <info@netflix.com>', subject: 'Your December payment', snippet: 'Payment of $15.49 was successful.', body: 'Your December payment of $15.49 was processed successfully using your card ending in 4432.', spam: false },
  { from: 'National Grid <billing@nationalgrid.com>', subject: 'Your gas bill for November', snippet: 'Amount due: $52.10, due December 5.', body: 'Your gas bill for November is now available. Amount due: $52.10, due by December 5th.', spam: false },
  { from: 'IRS <no-reply@irs.gov>', subject: 'Your e-file was accepted', snippet: 'Your tax return has been accepted for processing.', body: 'This confirms your electronically filed tax return has been accepted for processing. No further action is needed at this time.', spam: false },
  { from: 'Vanguard <do-not-reply@vanguard.com>', subject: 'Trade confirmation', snippet: 'Your recent trade has been executed and confirmed.', body: 'Your recent trade has been executed and confirmed. Details are available in your account activity.', spam: false },
  { from: 'T-Mobile <care@t-mobile.com>', subject: 'Your bill is ready', snippet: 'This month’s bill is $74.99, autopay scheduled.', body: 'This month’s bill is $74.99 and will be charged automatically on the 3rd via autopay, as usual.', spam: false },
  { from: 'American Express <alerts@americanexpress.com>', subject: 'Payment received, thank you', snippet: 'We’ve received your payment of $340.00.', body: 'We’ve received your payment of $340.00 and it has been applied to your account.', spam: false },

  // --- legitimate: newsletters/community (15) ---
  { from: 'The Morning Brief <news@themorningbrief.com>', subject: 'Today: rates hold, a big merger, and more', snippet: 'Your five-minute daily news summary.', body: 'Today: the central bank held interest rates steady, two mid-cap firms announced a merger, and the weekend weather outlook. Your five-minute daily summary.', spam: false },
  { from: 'Stack Overflow <do-not-reply@stackoverflow.email>', subject: 'Your weekly digest', snippet: 'Top questions in Python and JavaScript this week.', body: 'Here are the top questions in Python and JavaScript from your followed tags this week.', spam: false },
  { from: 'Ars Technica <newsletter@arstechnica.com>', subject: 'This week in tech', snippet: 'A roundup of the stories our editors picked.', body: 'A roundup of the stories our editors picked this week, from chip shortages to the latest in space launches.', spam: false },
  { from: 'Meetup <info@meetup.com>', subject: 'New events near you this week', snippet: 'Three groups you follow have new events.', body: 'Three groups you follow have posted new events happening this week near you.', spam: false },
  { from: 'Goodreads <noreply@goodreads.com>', subject: 'Friends’ recent reviews', snippet: 'See what your friends have been reading.', body: 'Here’s a look at what your friends on Goodreads have been reading and reviewing this month.', spam: false },
  { from: 'Strava <no-reply@strava.com>', subject: 'Your weekly summary', snippet: 'You logged 24 miles this week, up from last week.', body: 'Your weekly summary: you logged 24 miles this week, up from 18 last week. Keep it up!', spam: false },
  { from: 'Duolingo <hello@duolingo.com>', subject: 'You’re on a 12 day streak!', snippet: 'Keep it going with a quick lesson today.', body: 'You’re on a 12 day streak! Keep it going with a quick five-minute lesson today.', spam: false },
  { from: 'National Park Service <newsletter@nps.gov>', subject: 'Trail conditions update', snippet: 'Seasonal closures and current conditions.', body: 'This month’s update on seasonal trail closures and current conditions across the park.', spam: false },
  { from: 'Local Garden Club <info@rosedalegardenclub.org>', subject: 'Next meeting: Thursday 7pm', snippet: 'Topic this month: preparing beds for winter.', body: 'Our next meeting is Thursday at 7pm at the community hall. This month’s topic is preparing beds for winter.', spam: false },
  { from: 'Alumni Association <news@acmeuniversity.edu>', subject: 'Homecoming weekend is coming up', snippet: 'Tickets and schedule for this year’s events.', body: 'Homecoming weekend is coming up next month. Tickets and the full schedule of events are now available.', spam: false },
  { from: 'The Recipe Weekly <hello@reciperoundup.com>', subject: 'Five soups for cold nights', snippet: 'Our editors’ picks for the season.', body: 'Our editors have picked five hearty soups perfect for the colder nights ahead.', spam: false },
  { from: 'Nextdoor <updates@nextdoor.com>', subject: 'Popular posts in your neighbourhood', snippet: 'See what your neighbours are talking about.', body: 'Here are the most popular posts from your neighbourhood this week.', spam: false },
  { from: 'Gym Community <hello@ironworksgym.com>', subject: 'Holiday hours next week', snippet: 'Slightly adjusted opening times, see below.', body: 'Please note our opening hours will be slightly adjusted next week for the holiday. See the schedule below.', spam: false },
  { from: 'Bandcamp <noreply@bandcamp.com>', subject: 'New release from an artist you follow', snippet: 'They just dropped a new EP today.', body: 'An artist you follow on Bandcamp just released a new EP today.', spam: false },
  { from: 'Weather Service <alerts@weather.gov>', subject: 'Frost advisory tonight', snippet: 'Temperatures expected to drop below freezing.', body: 'A frost advisory is in effect for your area tonight as temperatures are expected to drop below freezing.', spam: false },

  // --- legitimate: misc (10) ---
  { from: 'Jamie <jamie.ortiz@gmail.com>', subject: 'Can you send the wifi password again?', snippet: 'Forgot to write it down before I left.', body: 'Sorry, forgot to write down the wifi password before I left, could you send it again?', spam: false },
  { from: 'Vet Clinic <appointments@oakvet.com>', subject: 'Reminder: Bella’s check-up tomorrow', snippet: 'Appointment at 10:30am, please arrive 10 minutes early.', body: 'This is a reminder that Bella’s annual check-up is tomorrow at 10:30am. Please arrive 10 minutes early to complete paperwork.', spam: false },
  { from: 'City Council <notices@cityhall.gov>', subject: 'Road closure on Main St this weekend', snippet: 'Due to the annual street festival.', body: 'Main Street will be closed to traffic this weekend due to the annual street festival. Plan alternate routes.', spam: false },
  { from: 'Landlord <r.patterson@gmail.com>', subject: 'Plumber coming Wednesday morning', snippet: 'To fix the kitchen sink, should take an hour.', body: 'The plumber is coming Wednesday morning to fix the kitchen sink, should take about an hour. Let me know if that doesn’t work.', spam: false },
  { from: 'Book Club <organizer@downtownbookclub.org>', subject: 'This month’s pick and meeting date', snippet: 'We’re reading a short story collection this time.', body: 'This month we’re reading a short story collection. Meeting is the third Tuesday as usual, same coffee shop.', spam: false },
  { from: 'Dentist Office <reminders@brightsmiledental.com>', subject: 'Appointment reminder: Friday 2pm', snippet: 'Routine cleaning, please confirm or reschedule.', body: 'This is a reminder of your routine cleaning appointment Friday at 2pm. Please confirm or call to reschedule.', spam: false },
  { from: 'Neighbour <carla.jimenez@gmail.com>', subject: 'Borrowing your ladder', snippet: 'Mine broke, could I grab yours for an hour?', body: 'Mine broke and I need to clean the gutters, could I grab your ladder for an hour this afternoon?', spam: false },
  { from: 'Car Dealership <service@rivertoyota.com>', subject: 'Your car is ready for pickup', snippet: 'The oil change and inspection are complete.', body: 'Your car is ready for pickup, the oil change and inspection are complete. No issues found.', spam: false },
  { from: 'Choir Director <music@stmarkschoir.org>', subject: 'Rehearsal moved to Wednesday this week', snippet: 'Same time, different room, see you there.', body: 'Just a heads up that rehearsal is moved to Wednesday this week because of a hall booking conflict. Same time, different room.', spam: false },
  { from: 'Insurance Agent <linda.moore@stateagency.com>', subject: 'Following up on your quote request', snippet: 'Happy to answer any questions before you decide.', body: 'Following up on the quote I sent last week, happy to answer any questions before you decide. No pressure either way.', spam: false },

  // --- legitimate: account/security (real, no suspicious link) (5) ---
  { from: 'Google <no-reply@accounts.google.com>', subject: 'Security alert: new sign-in on Windows', snippet: 'We noticed a new sign-in to your Google Account.', body: 'We noticed a new sign-in to your Google Account from a Windows device. If this was you, no action is needed.', links: [L('httpzs[:]//myaccount[.]google[.]com/notifications', 'Check activity')], spam: false },
  { from: 'Apple <no_reply@email.apple.com>', subject: 'Your Apple ID was used to sign in', snippet: 'A sign-in occurred on a new MacBook Pro.', body: 'Your Apple ID was used to sign in on a MacBook Pro. If this wasn’t you, you can secure your account from Settings.', spam: false },
  { from: 'Dropbox <no-reply@dropbox.com>', subject: 'New device linked to your account', snippet: 'A new device was linked to your Dropbox account.', body: 'A new device was just linked to your Dropbox account. If this was you, there’s nothing else to do.', spam: false },
  { from: 'Microsoft account team <account-security-noreply@accountprotection.microsoft.com>', subject: 'New sign-in to your Microsoft account', snippet: 'We noticed a new sign-in from Chrome on Windows.', body: 'We noticed a new sign-in to your Microsoft account from Chrome on Windows. If this was you, you can safely ignore this email.', spam: false },
  { from: 'GitHub <noreply@github.com>', subject: 'A new SSH key was added to your account', snippet: 'If you added this key, no action is needed.', body: 'A new SSH key was added to your account today. If you added this key, no action is needed.', spam: false },

  // --- legitimate: travel/events (5) ---
  { from: 'Airbnb <automated@airbnb.com>', subject: 'Your upcoming stay is confirmed', snippet: 'Check-in details for your trip next month.', body: 'Your upcoming stay is confirmed. Check-in details and the host’s contact information for your trip next month are attached.', spam: false },
  { from: 'Eventbrite <orders@eventbrite.com>', subject: 'Your ticket for Saturday’s concert', snippet: 'Your order is confirmed, ticket attached.', body: 'Your order for Saturday’s concert is confirmed. Your ticket is attached, please bring it or show it on your phone.', spam: false },
  { from: 'Marriott Bonvoy <reservations@marriott.com>', subject: 'Reservation confirmed for Dec 12-14', snippet: 'We look forward to welcoming you.', body: 'Your reservation for December 12th to 14th is confirmed. We look forward to welcoming you.', spam: false },
  { from: 'Amtrak <eticket@amtrak.com>', subject: 'Your eTicket for Friday', snippet: 'Train 92, departing 8:05am.', body: 'Your eTicket for Friday is attached. Train 92 departs at 8:05am from platform 3.', spam: false },
  { from: 'OpenTable <noreply@opentable.com>', subject: 'Reservation confirmed: 7:30pm Friday', snippet: 'Table for 4 at Riverside Bistro.', body: 'Your reservation for a table of 4 at Riverside Bistro this Friday at 7:30pm is confirmed.', spam: false },

  // --- spam: prize/lottery (4) ---
  { from: 'Prize Center <claim@prizecenter-award.tk>', subject: 'CONGRATULATIONS!! You have WON $1,000,000', snippet: 'You have been randomly selected as our grand prize winner!', body: 'CONGRATULATIONS!! You have been randomly selected as our grand prize winner of $1,000,000! Click below within 24 hours to claim your prize before it expires.', links: [L('httpz[:]//bit[.]ly/claim-prize-now', 'Claim your $1,000,000')], spam: true },
  { from: 'Reward Notice <no-reply@rewards-verify.top>', subject: 'You’ve earned a free iPhone 17!', snippet: 'Complete a short survey to claim your free phone.', body: 'Congratulations! You’ve earned a free iPhone 17 for being a loyal customer. Complete a short survey now to claim it before offers run out.', links: [L('httpz[:]//bit[.]ly/free-iphone17', 'www.apple.com')], spam: true },
  { from: 'National Lottery <winners@lotto-intl-claims.ru>', subject: 'Your ticket number has won £2,500,000', snippet: 'Contact our claims agent immediately to process your winnings.', body: 'We are pleased to inform you that your email address has won £2,500,000 in our international lottery draw. Contact our claims agent immediately with your personal details to process your winnings.', links: [L('httpz[:]//185[.]44[.]12[.]9/claim', 'Submit claim form')], spam: true },
  { from: 'Sweepstakes Dept <claims@sweepstakes-final.top>', subject: 'FINAL NOTICE: claim your prize today', snippet: 'This is your last chance to claim your winnings.', body: 'FINAL NOTICE: this is your last chance to claim your sweepstakes winnings. Act now before your prize is forfeited to another winner.', links: [L('httpz[:]//tinyurl[.]com/claim-final', 'Claim now')], spam: true },

  // --- spam: phishing / fake account alerts (4) ---
  { from: 'PayPal Security <security@paypal-secure92.tk>', subject: 'Your account has been limited', snippet: 'Unusual activity detected, verify your identity now.', body: 'We detected unusual activity on your account. Your account has been temporarily limited. Verify your identity now to restore full access.', links: [L('httpz[:]//paypal-secure92[.]tk/verify', 'paypal.com')], spam: true },
  { from: 'Apple Support <support@apple-id-verify.top>', subject: 'Your Apple ID has been locked', snippet: 'Suspicious sign-in attempt detected, verify now.', body: 'A suspicious sign-in attempt was detected on your Apple ID and it has been locked as a precaution. Verify your identity immediately to unlock it.', links: [L('httpz[:]//apple-id-verify[.]top/unlock', 'appleid.apple.com')], spam: true },
  { from: 'Bank Alert <alert@chase-online-verify.ru>', subject: 'Unusual login attempt on your account', snippet: 'Confirm your identity to prevent account suspension.', body: 'We detected an unusual login attempt on your online banking account. Confirm your identity within 24 hours to prevent suspension.', links: [L('httpz[:]//192[.]168[.]44[.]2/secure', 'Confirm identity')], spam: true },
  { from: 'Netflix Billing <billing@netflix-update-payment.tk>', subject: 'Your payment method failed', snippet: 'Update your payment details to keep your account active.', body: 'Your last payment attempt failed. Update your payment details now to avoid interruption to your account.', links: [L('httpz[:]//netflix-update-payment[.]tk/billing', 'netflix.com/account')], spam: true },

  // --- spam: fake invoice / wire fraud (3) ---
  { from: 'Accounts Payable <invoices@globaltrade-billing.top>', subject: 'Invoice #88213 overdue, pay immediately', snippet: 'Outstanding balance of $4,850 requires immediate payment.', body: 'Your outstanding invoice #88213 for $4,850 is now overdue. Immediate payment is required to avoid further action. Wire details attached.', links: [L('httpz[:]//bit[.]ly/inv-88213', 'View invoice')], spam: true },
  { from: 'CEO <ceo.office@acmecorp-exec.top>', subject: 'Urgent wire transfer needed', snippet: 'I need you to process a payment before end of day, can’t talk right now.', body: 'I’m in meetings all day and can’t talk, but I need you to process an urgent wire transfer to a new vendor before end of day. Reply for details.', spam: true },
  { from: 'DocuSign Alert <no-reply@docusign-review.tk>', subject: 'Please review and sign document', snippet: 'A document requires your signature within 48 hours.', body: 'A contract document requires your signature within 48 hours or it will be voided. Review and sign using the link below.', links: [L('httpz[:]//docusign-review[.]tk/sign', 'Review document')], spam: true },

  // --- spam: pharma / weight-loss / health scams (3) ---
  { from: 'MiracleHealth <offers@miracle-pharmacy-deals.top>', subject: 'Lose 20lbs in 2 weeks, doctors hate this trick', snippet: 'This one weird trick melts fat overnight.', body: 'Doctors hate this one weird trick that melts fat overnight! Lose 20lbs in just 2 weeks, no diet or exercise required. Limited stock, order now.', links: [L('httpz[:]//bit[.]ly/miracle-fat-loss', 'Order now')], spam: true },
  { from: 'PharmaDirect <sales@cheap-meds-online.ru>', subject: 'Prescription meds 90% off, no prescription needed', snippet: 'Order your medication online without a prescription.', body: 'Order your prescription medication online at 90% off, no prescription needed, discreet shipping worldwide.', links: [L('httpz[:]//cheap-meds-online[.]ru/order', 'Shop now')], spam: true },
  { from: 'VitalBoost <info@vitalboost-trial.top>', subject: 'Your free trial bottle is waiting', snippet: 'Just pay shipping for your free trial of our supplement.', body: 'Your free trial bottle of our miracle supplement is waiting, just pay a small shipping fee to claim it today.', links: [L('httpz[:]//vitalboost-trial[.]top/claim', 'Claim free trial')], spam: true },

  // --- spam: crypto / investment scam (3) ---
  { from: 'CryptoElite <invest@cryptoelite-returns.top>', subject: 'Turn $500 into $50,000 in 30 days', snippet: 'Our AI trading bot guarantees 100x returns.', body: 'Our exclusive AI trading bot guarantees 100x returns. Turn $500 into $50,000 in just 30 days, guaranteed or your money back.', links: [L('httpz[:]//bit[.]ly/crypto-100x', 'Start investing')], spam: true },
  { from: 'Elon Musk Foundation <giveaway@musk-crypto-giveaway.top>', subject: 'Elon Musk is giving away 5000 BTC', snippet: 'Send 0.1 BTC and receive 1 BTC back instantly.', body: 'To celebrate our anniversary, we are giving away 5000 BTC. Send 0.1 BTC to the address below and receive 1 BTC back instantly, verified by blockchain.', links: [L('httpz[:]//musk-crypto-giveaway[.]top/claim', 'Claim your BTC')], spam: true },
  { from: 'Wealth Signals <alerts@wealthsignals-vip.top>', subject: 'VIP trading signal: buy before market opens', snippet: 'Our insider signal has a 98% win rate.', body: 'Our VIP insider trading signal has a 98% win rate. Buy this stock before the market opens tomorrow for guaranteed profit.', links: [L('httpz[:]//tinyurl[.]com/vip-signal', 'Get the signal')], spam: true },

  // --- spam: tech support scam (2) ---
  { from: 'Microsoft Alert <support@microsoft-security-alert.top>', subject: 'Your computer has a virus, call now', snippet: 'Critical security threat detected on your PC.', body: 'CRITICAL: a security threat has been detected on your PC. Call our toll-free support line immediately to prevent data loss.', links: [L('httpz[:]//microsoft-security-alert[.]top/support', 'microsoft.com/support')], spam: true },
  { from: 'Norton Renewal <billing@norton-autorenew.ru>', subject: 'Your antivirus subscription has expired', snippet: 'Renew now or your device is at risk.', body: 'Your antivirus subscription has expired and your device is now at risk. Renew immediately to restore protection.', links: [L('httpz[:]//norton-autorenew[.]ru/renew', 'Renew now')], spam: true },

  // --- spam: romance/inheritance scam (2) ---
  { from: 'Barrister James Okoro <j.okoro.legal@inheritance-claims.top>', subject: 'Unclaimed inheritance of $8.4 million', snippet: 'I represent a deceased client who shares your surname.', body: 'I am a barrister representing a deceased client who shares your surname, who left an unclaimed inheritance of $8.4 million. Contact me privately to discuss your claim.', spam: true },
  { from: 'Anna <anna.sweetheart.love@mailrush.top>', subject: 'I feel a connection with you already', snippet: 'I found your profile and I think we could be perfect together.', body: 'Hello dear, I found your profile and I feel we could be perfect together. I am a nurse working abroad and would love to know you better. Please write back.', spam: true },

  // --- spam: fake shipping/customs (2) ---
  { from: 'DHL Express <delivery@dhl-parcel-notice.top>', subject: 'Your parcel is held, customs fee required', snippet: 'Pay a small fee to release your package for delivery.', body: 'Your parcel is currently held at customs. Pay a small release fee below to have it delivered to your address tomorrow.', links: [L('httpz[:]//bit[.]ly/dhl-release-fee', 'Pay release fee')], spam: true },
  { from: 'USPS Delivery <notice@usps-redelivery.tk>', subject: 'Delivery failed, reschedule now', snippet: 'We were unable to deliver your package, action required.', body: 'We attempted to deliver your package but were unable to. Reschedule delivery and confirm your address within 48 hours or it will be returned.', links: [L('httpz[:]//usps-redelivery[.]tk/reschedule', 'Reschedule delivery')], spam: true },

  // --- spam: fake job offer (2) ---
  { from: 'Recruiting Team <hr@remote-jobs-elite.top>', subject: 'You’ve been selected: $85/hr remote job', snippet: 'No experience needed, start earning today.', body: 'You have been selected for a remote position paying $85/hour. No experience needed, flexible hours, start earning today.', links: [L('httpz[:]//bit[.]ly/remote-job-apply', 'Apply now')], spam: true },
  { from: 'HireFast <careers@hirefast-opportunity.top>', subject: 'Mystery shopper needed, $500/week', snippet: 'We’ll mail you a check to get started right away.', body: 'We are hiring mystery shoppers in your area for $500/week. We’ll mail you a check upfront to get started right away, just reply with your address.', spam: true },
];

if (EMAILS.filter(e => e.spam).length !== SPAM_COUNT || EMAILS.length !== TOTAL) {
  throw new Error(`inbox/mail.js: expected ${TOTAL} emails with ${SPAM_COUNT} spam, got ${EMAILS.length} with ${EMAILS.filter(e => e.spam).length} spam`);
}

// One yes/no question per email, in one batch (well under the API's 256-question limit).
export function toRequest(emails = EMAILS) {
  const questions = {};
  emails.forEach((e, i) => {
    questions[`m${i}`] = { type: 'noul', instructions: `Subject: ${e.subject}\n${e.snippet}\n\nIs this email spam?` };
  });
  return { questions };
}

// Sorted folders from the model's answers, plus a scored comparison against the known ground truth.
export function sortMail(emails, answers) {
  const junk = [], inbox = [];
  let truePos = 0, trueNeg = 0, falsePos = 0, falseNeg = 0; // positive = spam
  emails.forEach((e, i) => {
    const p = answers[`m${i}`].noul, saidSpam = p >= 0.5;
    (saidSpam ? junk : inbox).push({ ...e, p });
    if (saidSpam && e.spam) truePos++;
    else if (!saidSpam && !e.spam) trueNeg++;
    else if (saidSpam && !e.spam) falsePos++; // legit mail wrongly binned as junk: the costly mistake
    else falseNeg++;                          // spam that reached the inbox
  });
  const accuracy = (truePos + trueNeg) / emails.length;
  return { inbox, junk, accuracy, truePos, trueNeg, falsePos, falseNeg };
}
