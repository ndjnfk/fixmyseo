# vidushiji.com SEO plan v1

> Keyword volumes aur difficulty yahan **validated nahi** hain (abhi koi keyword tool/GSC data nahi). Ye intent-based hypotheses hain. Priority GSC data aane par badlegi.

## 1. Keyword clusters

| # | Cluster | Target URL | Primary keywords | Intent | Priority |
|---|---|---|---|---|---|
| 1 | Free Kundli | /kundli | free kundli, kundli online, janam kundli banaye, kundli in hindi | Tool | High |
| 2 | Kundli Milan | /matching | kundli milan, guna milan online, shadi ke liye kundli matching, 36 gun milan | Tool | High |
| 3 | Tarot | /tarot | online tarot reading, tarot card reading hindi, tarot reader india | Commercial | High |
| 4 | Love tarot | /tarot/love | love tarot reading, will he come back tarot, relationship tarot | Commercial/Info | Medium |
| 5 | Career tarot | /tarot/career | career tarot reading, job change tarot, business tarot | Commercial | Medium |
| 6 | Rituals / pooja | /rituals | online pooja consultation, graha shanti pooja, ritual for dosh | Commercial | Medium |
| 7 | Healing stones | /shop | healing bracelet, crystal bracelet india, gemstone bracelet for career | Transactional | Medium |
| 8 | Other modalities | /tarot/numerology, /tarot/palmistry | numerology reading, palm reading online | Commercial | Low |
| 9 | Info/blog | /blog/* | tarot card meanings, manglik dosh kya hai, kundli me 36 gun | Informational | High (traffic) |

Hindi aur English dono variants rakhna (Hindi: `/hi/...` ya alag hreflang pages).

## 2. Site structure

```
/                    Home
/kundli              Free Kundli tool  (+ FAQ)
/matching            Kundli Milan tool (+ FAQ)
/tarot               Tarot hub
  /tarot/love  /tarot/career  /tarot/health  /tarot/numerology  /tarot/palmistry
/rituals
/shop  -> /shop/{product}
/pricing  /about  /reviews  /contact
/blog  -> pillar + supporting posts
/account/*           noindex
```

Internal links: blog posts -> relevant tool/service page; tool pages <-> related tarot pages.

## 3. On-page pack

Brand: "Vidushi Ji". Title <= 60, meta <= 160 chars.

| URL | Title | Meta description | H1 |
|---|---|---|---|
| / | Vidushi Ji: Tarot Reading & Vedic Astrology Online | Book a personal tarot or Vedic astrology session with Vidushi Ji. Free Kundli and Guna Milan tools, readings across India. | Tarot Reading & Vedic Astrology by Vidushi Ji |
| /kundli | Free Kundli Online: Janam Kundli in Hindi & English | Create your free Kundli online from date, time and place of birth. Get planets, houses and dasha, with guidance from Vidushi Ji. | Free Kundli (Janam Kundli) Online |
| /matching | Kundli Milan Online: Free Guna Milan for Marriage | Check Kundli matching and Guna Milan (36 gunas) for marriage online. See Manglik status and compatibility instantly. | Kundli Milan & Guna Milan Online |
| /tarot | Online Tarot Reading in India by Vidushi Ji | Personal one-on-one tarot reading on love, career and health. Book a session with Vidushi Ji by chat or call. | Online Tarot Reading by Vidushi |
| /rituals | Online Pooja & Ritual Consultation | Vidushi Ji | Get guidance on rituals and remedies tailored to your chart. Book a ritual consultation with Vidushi Ji. | Ritual & Remedy Consultation |
| /shop | Healing Bracelets & Crystal Stones | Vidushi Ji Shop | Energized healing bracelets and crystal stones, selected by Vidushi Ji. Shipping across India. | Healing Bracelets & Stones |
| /pricing | Tarot Reading Price & Session Plans | Vidushi Ji | See session plans and pricing for tarot and astrology readings with Vidushi Ji. | Session Pricing |
| /about | About Vidushi Ji: Tarot Reader & Astrologer | Know Vidushi Ji, her background, training and approach to tarot and Vedic astrology. | About Vidushi Ji |
| /reviews | Client Reviews | Vidushi Ji Tarot & Astrology | Read what clients say about their sessions with Vidushi Ji. | Client Reviews |
| /contact | Contact Vidushi Ji | Book a Session | Contact Vidushi Ji to book a tarot or astrology session. Reach out by form, phone or WhatsApp. | Contact & Booking |

Note: `/about` ka content tabhi likhna jab Vidushi Ji ki **asli** qualification/experience di jaye. Fake credentials ya reviews nahi.

### FAQ (FAQPage schema ke liye, /kundli ke example)

- Kundli kya hai? Janam kundli aapke janm ke samay, tithi aur sthan ke aadhar par grahon ki sthiti ka chart hai.
- Free Kundli ke liye kya details chahiye? Date, exact time aur place of birth.
- Kya online Kundli accurate hoti hai? Birth time sahi ho to calculation accurate hoti hai; interpretation ke liye astrologer se baat karein.
- Guna Milan mein kitne gun hote hain? 36, aur 18 se zyada ko aam taur par acceptable maana jaata hai.

## 4. Schema (JSON-LD)

Site-wide (home):

```json
{
  "@context": "https://schema.org",
  "@type": "WebSite",
  "name": "Vidushi Ji",
  "url": "https://vidushiji.com"
}
```

/about (Person) aur /tarot (Service):

```json
{
  "@context": "https://schema.org",
  "@type": "Service",
  "name": "Online Tarot Reading",
  "provider": { "@type": "Person", "name": "Vidushi Ji" },
  "areaServed": { "@type": "Country", "name": "India" },
  "serviceType": "Tarot reading"
}
```

/shop/{product}: `Product` + `Offer` (price/currency real data se). `aggregateRating` **sirf tab** jab real, verifiable reviews hon.

## 5. Technical checklist (developer ke liye)

1. **Per-page title/meta** (abhi sab pages par same: "Vidushiji.ai — Vedic Astrology"). Next.js: `generateMetadata` ya `metadata` export.
2. **Server-side render/prerender** key pages, taaki title, H1 aur content raw HTML mein ho.
3. `sitemap.xml` banao aur robots.txt mein `Sitemap:` line daalo (abhi 404).
4. Har page par `<link rel="canonical">`; `/?book=1` jaise parameter URLs ko canonical `/` par point karo.
5. `noindex` on `/account/*` aur booking-parameter URLs.
6. Sab images par descriptive `alt`.
7. `/kundli` aur `/matching` par tool ke neeche 600+ words ka original content + FAQ.
8. Contact details (phone/WhatsApp/email) visible karo; trust ke liye zaroori.
9. Google Search Console aur GA4 verify/install karo.

## 6. Pehle 8 hafte ka content (blog)

| Week | Post | Links to |
|---|---|---|
| 1 | Kundli kya hai aur kaise padhein | /kundli |
| 2 | Kundli milan mein 36 gun ka matlab | /matching |
| 3 | Manglik dosh kya hai aur kya karein | /matching, /rituals |
| 4 | Tarot reading kaise kaam karti hai | /tarot |
| 5 | Tarot cards ke meanings (Major Arcana) | /tarot |
| 6 | Love tarot: kab karwayein, kya poochein | /tarot/love |
| 7 | Career confusion ke liye tarot | /tarot/career |
| 8 | Healing crystals: kya sach hai, kya nahi | /shop |

Har post ke liye outline aur Vidushi Ji ka original input (unka experience, real examples) chahiye; sirf AI draft publish nahi karna.

## 7. Measure karna

Search Console: impressions/clicks per cluster. GA4: kundli/matching tool use, booking click, WhatsApp click. Funnel: impressions -> clicks -> tool use -> booking.
