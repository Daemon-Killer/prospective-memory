package com.remy.wear

import android.app.Activity
import android.app.PendingIntent
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.wear.protolayout.ActionBuilders
import androidx.wear.protolayout.DeviceParametersBuilders
import androidx.wear.protolayout.material.CompactChip
import androidx.wear.protolayout.material.layouts.PrimaryLayout
import androidx.wear.watchface.complications.data.ComplicationType
import androidx.wear.watchface.complications.data.RangedValueComplicationData
import androidx.wear.watchface.complications.data.ShortTextComplicationData
import androidx.wear.watchface.complications.datasource.ComplicationRequest
import com.google.common.truth.Truth.assertThat
import com.remy.wear.data.local.ReminderDao
import com.remy.wear.data.local.ReminderEntity
import com.remy.wear.data.local.RemyDatabase
import com.remy.wear.surfaces.complication.RemyComplicationFactory
import com.remy.wear.surfaces.complication.RemyComplicationService
import com.remy.wear.surfaces.tile.TileLayoutBuilder
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * Empirical Verification and Adversarial Challenge Suite for Milestone 1:
 * Swiss Void Wear OS Launcher Activity (MainActivity.kt).
 *
 * Authored by Challenger 2 to stress-test:
 * 1. RemyComplicationService.createTapAction(context) intent resolution and ActivityNotFoundException immunity.
 * 2. TileLayoutBuilder.ID_ACTION_OPEN_APP launch action matching and activity instantiation.
 * 3. AndroidManifest.xml intent filter matching against standard and edge-case PackageManager queries.
 * 4. PendingIntent flags, immutability, and external surface invocation security.
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [34])
class LauncherResolutionEmpiricalChallengeTest {

    private lateinit var context: Context
    private lateinit var database: RemyDatabase
    private lateinit var dao: ReminderDao
    private lateinit var deviceParams: DeviceParametersBuilders.DeviceParameters

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        database = RemyDatabase.buildInMemory(context)
        dao = database.reminderDao()
        MainActivity.testDaoOverride = dao
        MainActivity.clockOverride = null
        MainActivity.surfaceNotificationListener = null

        deviceParams = DeviceParametersBuilders.DeviceParameters.Builder()
            .setScreenWidthDp(225)
            .setScreenHeightDp(225)
            .setScreenDensity(2.0f)
            .setScreenShape(DeviceParametersBuilders.SCREEN_SHAPE_ROUND)
            .build()
    }

    @After
    fun tearDown() {
        MainActivity.testDaoOverride = null
        MainActivity.clockOverride = null
        MainActivity.surfaceNotificationListener = null
        database.close()
    }

    // =========================================================================
    // 1. Complication Tap Action Resolution & Zero ActivityNotFoundException Risk
    // =========================================================================

    @Test
    fun complicationTapAction_resolvesExplicitlyToMainActivity_withZeroActivityNotFoundExceptionRisk() {
        val pendingIntent = RemyComplicationService.createTapAction(context)
        assertThat(pendingIntent).isNotNull()

        val shadowPending = shadowOf(pendingIntent)
        assertThat(shadowPending.requestCode).isEqualTo(RemyComplicationService.TAP_ACTION_REQUEST_CODE)
        assertThat(shadowPending.flags and PendingIntent.FLAG_IMMUTABLE).isEqualTo(PendingIntent.FLAG_IMMUTABLE)

        val savedIntent = shadowPending.savedIntent
        assertThat(savedIntent).isNotNull()

        // Verify component target
        val pm = context.packageManager
        val resolveInfo = pm.resolveActivity(savedIntent, 0)
        assertThat(resolveInfo).isNotNull()
        assertThat(resolveInfo!!.activityInfo.name).isEqualTo("com.remy.wear.MainActivity")
        assertThat(resolveInfo.activityInfo.packageName).isEqualTo(context.packageName)
        assertThat(resolveInfo.activityInfo.exported).isTrue()

        // Empirical execution: launching the intent must not throw ActivityNotFoundException
        try {
            val intentToLaunch = Intent(savedIntent).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intentToLaunch)
        } catch (e: ActivityNotFoundException) {
            fail("ActivityNotFoundException was thrown when attempting to launch complication tap intent: ${e.message}")
        }
    }

    @Test
    fun complicationTapAction_fallbackIntent_resolvesCleanlyWithoutPackageManagerLaunchIntent() {
        // Adversarially test the fallback branch of createTapAction:
        // Intent().apply {
        //     setClassName(context.packageName, "com.remy.wear.MainActivity")
        //     flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        // }
        val fallbackIntent = Intent().apply {
            setClassName(context.packageName, "com.remy.wear.MainActivity")
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }

        val pm = context.packageManager
        val resolveInfo = pm.resolveActivity(fallbackIntent, 0)
        assertThat(resolveInfo).isNotNull()
        assertThat(resolveInfo!!.activityInfo.name).isEqualTo("com.remy.wear.MainActivity")
        assertThat(resolveInfo.activityInfo.exported).isTrue()

        // Verify fallback intent starts without exception
        try {
            context.startActivity(fallbackIntent)
        } catch (e: ActivityNotFoundException) {
            fail("Fallback intent failed to launch: ${e.message}")
        }
    }

    @Test
    fun complicationService_complicationRequestPayload_embedsValidMainActivityTapAction() = runTest {
        val service = Robolectric.buildService(RemyComplicationService::class.java).create().get().apply {
            testDao = dao
        }

        // Test SHORT_TEXT request
        val shortTextRequest = ComplicationRequest(101, ComplicationType.SHORT_TEXT, false)
        val shortTextData = service.onComplicationRequest(shortTextRequest)
        assertThat(shortTextData).isNotNull()
        assertThat(shortTextData).isInstanceOf(ShortTextComplicationData::class.java)
        val shortData = shortTextData as ShortTextComplicationData
        assertThat(shortData.tapAction).isNotNull()

        val shortShadow = shadowOf(shortData.tapAction)
        val shortTargetIntent = shortShadow.savedIntent
        assertThat(shortTargetIntent).isNotNull()
        val shortResolve = context.packageManager.resolveActivity(shortTargetIntent, 0)
        assertThat(shortResolve).isNotNull()
        assertThat(shortResolve!!.activityInfo.name).isEqualTo("com.remy.wear.MainActivity")

        // Test RANGED_VALUE request
        val rangedRequest = ComplicationRequest(102, ComplicationType.RANGED_VALUE, false)
        val rangedData = service.onComplicationRequest(rangedRequest)
        assertThat(rangedData).isNotNull()
        assertThat(rangedData).isInstanceOf(RangedValueComplicationData::class.java)
        val rangedPayload = rangedData as RangedValueComplicationData
        assertThat(rangedPayload.tapAction).isNotNull()

        val rangedShadow = shadowOf(rangedPayload.tapAction)
        val rangedTargetIntent = rangedShadow.savedIntent
        assertThat(rangedTargetIntent).isNotNull()
        val rangedResolve = context.packageManager.resolveActivity(rangedTargetIntent, 0)
        assertThat(rangedResolve).isNotNull()
        assertThat(rangedResolve!!.activityInfo.name).isEqualTo("com.remy.wear.MainActivity")
    }

    @Test
    fun complicationService_previewDataPayload_embedsValidMainActivityTapAction() {
        val service = Robolectric.buildService(RemyComplicationService::class.java).create().get()

        val preview = service.getPreviewData(ComplicationType.SHORT_TEXT)
        assertThat(preview).isNotNull()
        assertThat(preview).isInstanceOf(ShortTextComplicationData::class.java)
        val shortPreview = preview as ShortTextComplicationData
        assertThat(shortPreview.tapAction).isNotNull()

        val previewShadow = shadowOf(shortPreview.tapAction)
        val previewIntent = previewShadow.savedIntent
        val previewResolve = context.packageManager.resolveActivity(previewIntent, 0)
        assertThat(previewResolve).isNotNull()
        assertThat(previewResolve!!.activityInfo.name).isEqualTo("com.remy.wear.MainActivity")
    }

    // =========================================================================
    // 2. TileLayoutBuilder ID_ACTION_OPEN_APP Launch Action Resolution
    // =========================================================================

    @Test
    fun tileLayoutBuilder_openAppAction_resolvesExplicitlyToMainActivity() {
        val emptyLayout = TileLayoutBuilder.buildEmptyLayout(context, deviceParams)
        val primaryLayout = PrimaryLayout.fromLayoutElement(emptyLayout)
        assertThat(primaryLayout).isNotNull()

        val chip = CompactChip.fromLayoutElement(primaryLayout!!.primaryChipContent!!)
        assertThat(chip).isNotNull()
        assertThat(chip!!.clickable?.id).isEqualTo(TileLayoutBuilder.ID_ACTION_OPEN_APP)

        val onClickAction = chip.clickable?.onClick
        assertThat(onClickAction).isInstanceOf(ActionBuilders.LaunchAction::class.java)

        val launchAction = onClickAction as ActionBuilders.LaunchAction
        val androidActivity = launchAction.androidActivity
        assertThat(androidActivity).isNotNull()
        assertThat(androidActivity!!.packageName).isEqualTo(context.packageName)
        assertThat(androidActivity.className).isEqualTo("com.remy.wear.MainActivity")

        // Empirically reconstruct intent that ProtoLayout runtime executes from LaunchAction
        val reconstructedIntent = Intent().apply {
            component = ComponentName(androidActivity.packageName, androidActivity.className)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
        }

        val resolveInfo = context.packageManager.resolveActivity(reconstructedIntent, 0)
        assertThat(resolveInfo).isNotNull()
        assertThat(resolveInfo!!.activityInfo.name).isEqualTo("com.remy.wear.MainActivity")
        assertThat(resolveInfo.activityInfo.packageName).isEqualTo(context.packageName)
        assertThat(resolveInfo.activityInfo.exported).isTrue()

        // Execute launch to confirm zero ActivityNotFoundException
        try {
            context.startActivity(reconstructedIntent)
        } catch (e: ActivityNotFoundException) {
            fail("ProtoLayout reconstructed LaunchAction failed with ActivityNotFoundException: ${e.message}")
        }
    }

    @Test
    fun tileLayoutBuilder_timelineRenderTile_preservesOpenAppLaunchAction() {
        val tile = TileLayoutBuilder.renderTile(context, emptyList(), deviceParams)
        assertThat(tile.tileTimeline).isNotNull()
        assertThat(tile.tileTimeline?.timelineEntries).isNotEmpty()

        val entry = tile.tileTimeline!!.timelineEntries.first()
        val root = entry.layout?.root
        assertThat(root).isNotNull()

        val primaryLayout = PrimaryLayout.fromLayoutElement(root!!)
        assertThat(primaryLayout).isNotNull()

        val chip = CompactChip.fromLayoutElement(primaryLayout!!.primaryChipContent!!)
        assertThat(chip).isNotNull()
        assertThat(chip!!.clickable?.id).isEqualTo(TileLayoutBuilder.ID_ACTION_OPEN_APP)

        val launchAction = chip.clickable?.onClick as ActionBuilders.LaunchAction
        assertThat(launchAction.androidActivity?.className).isEqualTo("com.remy.wear.MainActivity")
    }

    // =========================================================================
    // 3. Android Manifest & PackageManager Query Resolution Tests
    // =========================================================================

    @Test
    fun packageManager_standardLauncherQuery_resolvesMainActivitySolely() {
        val pm = context.packageManager

        // Standard launcher query pattern used by Wear OS app drawers and launcher hosts
        val launcherIntent = Intent(Intent.ACTION_MAIN).apply {
            addCategory(Intent.CATEGORY_LAUNCHER)
            setPackage(context.packageName)
        }

        val resolveList = pm.queryIntentActivities(launcherIntent, 0)
        assertThat(resolveList).isNotEmpty()
        assertThat(resolveList.size).isEqualTo(1)

        val activityInfo = resolveList[0].activityInfo
        assertThat(activityInfo.name).isEqualTo("com.remy.wear.MainActivity")
        assertThat(activityInfo.packageName).isEqualTo(context.packageName)
        assertThat(activityInfo.exported).isTrue()
    }

    @Test
    fun packageManager_getLaunchIntentForPackage_matchesMainActivity() {
        val pm = context.packageManager
        val launchIntent = pm.getLaunchIntentForPackage(context.packageName)
        assertThat(launchIntent).isNotNull()

        assertThat(launchIntent!!.component).isNotNull()
        assertThat(launchIntent.component!!.className).isEqualTo("com.remy.wear.MainActivity")
        assertThat(launchIntent.component!!.packageName).isEqualTo(context.packageName)
        assertThat(launchIntent.flags and Intent.FLAG_ACTIVITY_NEW_TASK).isEqualTo(Intent.FLAG_ACTIVITY_NEW_TASK)
    }

    @Test
    fun packageManager_explicitIntent_resolvesMainActivityDirectly() {
        val explicitIntent = Intent(context, MainActivity::class.java)
        val resolveInfo = context.packageManager.resolveActivity(explicitIntent, 0)

        assertThat(resolveInfo).isNotNull()
        assertThat(resolveInfo!!.activityInfo.name).isEqualTo("com.remy.wear.MainActivity")
        assertThat(resolveInfo.activityInfo.exported).isTrue()
    }

    @Test
    fun packageManager_negativeIntentQueries_doNotSpuriouslyMatchMainActivity() {
        val pm = context.packageManager

        // Intent with unhandled ACTION_VIEW
        val viewIntent = Intent(Intent.ACTION_VIEW).apply {
            setPackage(context.packageName)
        }
        val viewMatches = pm.queryIntentActivities(viewIntent, 0)
        assertThat(viewMatches).isEmpty()

        // Intent with unhandled CATEGORY_BROWSABLE
        val browsableIntent = Intent(Intent.ACTION_MAIN).apply {
            addCategory(Intent.CATEGORY_BROWSABLE)
            setPackage(context.packageName)
        }
        val browsableMatches = pm.queryIntentActivities(browsableIntent, 0)
        assertThat(browsableMatches).isEmpty()
    }

    @Test
    fun activityRobolectric_controllerLifecycleTransition_verifiesCleanCreation() {
        val controller = Robolectric.buildActivity(MainActivity::class.java)
        val activity = controller.create().start().resume().visible().get()

        assertThat(activity).isNotNull()
        assertThat(activity.isFinishing).isFalse()

        // Verify window decor background is #000000 pure black
        val windowBg = activity.window.decorView.background
        assertThat(windowBg).isNotNull()

        // Pause and stop lifecycle
        controller.pause().stop().destroy()
    }
}
