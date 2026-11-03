#include <gtest/gtest.h>

#include "imgshrink/image.h"

using imgshrink::fitWithin;

TEST(FitWithin, ShrinksToTheLimitingSideAndKeepsTheAspectRatio) {
    int w = 0, h = 0;
    fitWithin(4000, 3000, 1600, 1600, w, h);
    EXPECT_EQ(w, 1600);
    EXPECT_EQ(h, 1200);
    fitWithin(3000, 4000, 1600, 1600, w, h);
    EXPECT_EQ(w, 1200);
    EXPECT_EQ(h, 1600);
}

TEST(FitWithin, NeverEnlarges) {
    int w = 0, h = 0;
    fitWithin(800, 600, 1600, 1600, w, h);
    EXPECT_EQ(w, 800);
    EXPECT_EQ(h, 600);
}

TEST(FitWithin, ZeroMeansNoLimitOnThatSide) {
    int w = 0, h = 0;
    fitWithin(4000, 3000, 2000, 0, w, h);
    EXPECT_EQ(w, 2000);
    EXPECT_EQ(h, 1500);
    fitWithin(4000, 3000, 0, 0, w, h);
    EXPECT_EQ(w, 4000);
    EXPECT_EQ(h, 3000);
}

TEST(FitWithin, ExtremeAspectRatiosStayAtLeastOnePixel) {
    int w = 0, h = 0;
    fitWithin(10000, 3, 100, 100, w, h);
    EXPECT_EQ(w, 100);
    EXPECT_EQ(h, 1);
}
