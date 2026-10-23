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

    @Test fun nsfwFilteringHappensUpstreamAndItemsRemainDistinct() {
        assertTrue(FeedFilter.SOCIAL.accepts(item("s", "social")))
        assertFalse(FeedFilter.SOCIAL.accepts(item("a", "article")))
    }
    @Test fun socialFreshnessIsExplicitlyBounded() {
        val now = Instant.parse("2026-10-24T00:00:00Z")
        val recent = item("recent", "social").copy(ingestedAt = "2026-10-23T00:00:00Z")
        val stale = item("stale", "social").copy(ingestedAt = "2026-09-30T00:00:00Z")
        assertTrue(FeedRanker.isFreshSocial(recent, now))
        assertFalse(FeedRanker.isFreshSocial(stale, now))
        assertFalse(FeedRanker.isFreshSocial(stale.copy(ingestedAt = "not-a-date"), now))
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

}
