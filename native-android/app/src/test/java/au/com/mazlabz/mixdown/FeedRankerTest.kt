package au.com.mazlabz.mixdown

import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class FeedRankerTest {
    private fun item(id: String, kind: String, bucket: String = "entertainment") = FeedItem(
        id, kind, "Title " + id, "", "", bucket,
        if (kind == "video") "https://example.org/" + id + ".mp4" else "",
        if (kind == "video") "mp4" else "",
        "", "", emptyList(), "", "2026-10-20T01:00:00Z", 0.7, 0.6, 0.8, false
    )

    @Test fun boundedBackfillSkipsSeenOnlyPagesWithoutInfiniteRequests() {
        assertTrue(FeedBackfill.shouldContinue(0, 2, 0))
        assertTrue(FeedBackfill.shouldContinue(2, 1, 7))
        assertFalse(FeedBackfill.shouldContinue(4, 2, 0))
        assertFalse(FeedBackfill.shouldContinue(1, 0, 0))
        assertFalse(FeedBackfill.shouldContinue(1, 2, 8))
    }

    @Test fun paginationAdvancesByRawServerRowsEvenAfterFiltering() {
        val filtered = FeedBatch(listOf(item("valid", "video")), received = 45)
        assertEquals(90, filtered.nextOffset(45))
        assertEquals(45, filtered.received)
        assertEquals(1, filtered.items.size)
        assertEquals(45, FeedBatch(emptyList(), received = 45).nextOffset(0))
        assertEquals(45, FeedBatch(emptyList(), received = 0).nextOffset(45))
    }

    @Test fun rssMetadataIsReadableNotXml() {
        assertEquals("Tom Warren", FeedText.plain("<name>Tom Warren</name>"))
        assertEquals("Rock & Roll", FeedText.plain("Rock &amp; Roll"))
        assertEquals("Tom Warren", FeedText.plain("&lt;name&gt;Tom Warren&lt;/name&gt;"))
        assertEquals("Xbox's news", FeedText.plain("Xbox&#39;s news"))
    }

    @Test fun noDuplicatesInMixedFeed() {
        val items = listOf(item("v1", "video"), item("v1", "video"), item("a1", "article"))
        assertEquals(2, FeedRanker.rank(items, Taste(), FeedFilter.ALL).size)
    }

    @Test fun videosAreActuallyPlayable() {
        val broken = item("v1", "video").copy(mediaUrl = "")
        val valid = item("v2", "video")
        assertEquals(listOf("v2"), FeedRanker.rank(listOf(broken, valid), Taste(), FeedFilter.VIDEOS).map { it.id })
    }

    @Test fun mixedFeedDoesNotCollapseToOnlyArticles() {
        val articles = (0..30).map { item("a" + it, "article") }
        val videos = (0..10).map { item("v" + it, "video") }
        val feed = FeedRanker.rank(articles + videos, Taste(), FeedFilter.ALL)
        assertTrue(feed.take(8).count { it.kind == "video" } >= 3)
        assertTrue(feed.take(8).count { it.kind == "article" } >= 1)
    }

    @Test fun interestWeightsAffectOrdering() {
        val tech = item("tech", "article", "software-depth")
        val play = item("play", "article", "entertainment")
        val taste = Taste(tech = 1.0f, entertainment = 0f, comedy = 0f, shorts = 0f)
        assertEquals("tech", FeedRanker.rank(listOf(play, tech), taste, FeedFilter.ARTICLES).first().id)
    }

    @Test fun theMainFeedContainsOnlyPlayableVideosAndReadableArticles() {
        assertFalse(FeedFilter.ALL.accepts(item("s", "social")))
        assertFalse(FeedFilter.ALL.accepts(item("v", "video").copy(mediaUrl = "")))
        assertTrue(FeedFilter.ALL.accepts(item("v", "video")))
        assertTrue(FeedFilter.ARTICLES.accepts(item("a", "article")))
        assertFalse(FeedFilter.ARTICLES.accepts(item("v", "video")))
        assertEquals(listOf("Your Mix", "Watch", "Stories"),
            FeedFilter.entries.map { it.title })
    }

    @Test fun publicationDateWinsOverRecentIngestionForArticles() {
        val archive = item("old", "article").copy(
            publishedAt = "2020-10-08T20:50:55Z",
            ingestedAt = "2026-10-23T18:30:08Z")
        val actualRecent = item("fresh", "article").copy(
            publishedAt = "2026-10-23T20:50:55Z",
            ingestedAt = "2026-10-20T18:30:08Z")
        val ranked = FeedRanker.rank(listOf(archive, actualRecent),
            Taste(), FeedFilter.ARTICLES)
        assertEquals("fresh", ranked.first().id)
    }
    @Test fun socialFreshnessIsExplicitlyBounded() {
        val now = Instant.parse("2026-10-24T00:00:00Z")
        val recent = item("recent", "social").copy(publishedAt = "2026-10-23T00:00:00Z")
        val stale = item("stale", "social").copy(publishedAt = "2026-09-30T00:00:00Z")
        assertTrue(FeedRanker.isFreshSocial(recent, now))
        assertFalse(FeedRanker.isFreshSocial(stale, now))
        assertFalse(FeedRanker.isFreshSocial(stale.copy(publishedAt = "not-a-date"), now))
    }

    @Test fun alternatePublishersWhenPossible() {
        val input = listOf(
            item("one", "article").copy(permalink = "https://alpha.test/one"),
            item("two", "article").copy(permalink = "https://alpha.test/two"),
            item("three", "article").copy(permalink = "https://beta.test/three"),
            item("four", "article").copy(permalink = "https://alpha.test/four")
        )
        val ranked = FeedRanker.diversifySources(input)
        assertEquals(listOf("one", "three", "two", "four"), ranked.map { it.id })
    }

    @Test fun onePublisherDoesNotDropItems() {
        val input = (1..5).map {
            item("story" + it, "article").copy(permalink = "https://alpha.test/" + it)
        }
        assertEquals(input.map { it.id }, FeedRanker.diversifySources(input).map { it.id })
    }


    @Test fun nsfwVideosTabDoesNotHideOtherPublishersBehindRedgifs() {
        val redgifs = (1..8).map { index ->
            item("red" + index, "video").copy(
                permalink = "https://www.redgifs.com/watch/" + index,
                quality = 1.0, visual = 1.0, engagement = 1.0,
                isNsfw = true
            )
        }
        val bluesky = item("bluesky", "video").copy(
            permalink = "https://bsky.app/profile/creator/post/123",
            quality = 0.3, visual = 0.3, engagement = 0.3,
            isNsfw = true
        )
        val mastodon = item("mastodon", "video").copy(
            permalink = "https://thicc.horse/@creator/123",
            quality = 0.3, visual = 0.3, engagement = 0.3,
            isNsfw = true
        )
        val ranked = FeedRanker.rank(redgifs + bluesky + mastodon, Taste(), FeedFilter.VIDEOS)
        assertEquals(10, ranked.size)
        assertTrue(ranked.take(5).any { it.id == "bluesky" })
        assertTrue(ranked.take(5).any { it.id == "mastodon" })
    }

    @Test fun sourceAndTopicMixIsVaried() {
        val input = listOf(
            item("a1","article","software-depth").copy(permalink="https://one.test/a1"),
            item("a2","article","software-depth").copy(permalink="https://one.test/a2"),
            item("b1","article","science").copy(permalink="https://two.test/b1"),
            item("a3","article","software-depth").copy(permalink="https://one.test/a3"),
            item("c1","article","entertainment").copy(permalink="https://three.test/c1")
        )
        val result = FeedRanker.diversifySources(input)
        assertEquals(5, result.distinctBy { it.id }.size)
        assertEquals(listOf("a1","b1","c1"), result.take(3).map { it.id })
    }

    @Test fun latestSelectionRewardsActualPublicationDate() {
        val older = item("old","article").copy(publishedAt="2026-10-10T00:00:00Z", ingestedAt="2026-10-27T00:00:00Z")
        val newer = item("new","article").copy(publishedAt="2026-10-27T00:00:00Z", ingestedAt="2026-10-20T00:00:00Z")
        val ranked = FeedRanker.rank(listOf(older,newer), Taste(), FeedFilter.ARTICLES, FeedMode.LATEST)
        assertEquals("new",ranked.first().id)
    }

    @Test fun feedbackPrioritisesMatchingTopicAndDomain() {
        val alpha = item("alpha","article","science").copy(permalink="https://alpha.test/a")
        val beta = item("beta","article","entertainment").copy(permalink="https://beta.test/b")
        val preferences = mapOf("topic:science" to 1.5f, "source:alpha.test" to 1.5f)
        val ranked = FeedRanker.rank(listOf(beta,alpha),Taste(),FeedFilter.ARTICLES, FeedMode.EXPLORE,preferences)
        assertEquals("alpha",ranked.first().id)
    }

    @Test fun freshCommunityCanAppearInTheMixButNotStoriesOrWatch() {
        val article = item("article","article")
        val social = item("social","social").copy(publishedAt=Instant.now().toString())
        val combined = FeedRanker.rank(listOf(article,social),Taste(),FeedFilter.ALL)
        assertTrue(combined.any { it.id=="social" })
        assertEquals(listOf("article"),FeedRanker.rank(listOf(article,social),Taste(),FeedFilter.ARTICLES).map { it.id })
        assertFalse(FeedFilter.VIDEOS.accepts(social))
    }
}
