import pytest

from mock_carrier.config import CarrierConfig, SinkBehaviour, SinkConfig


def test_defaults_match_the_contract() -> None:
    assert CarrierConfig.from_env({}) == CarrierConfig(
        gateway_url="http://gateway:8000",
        dlr_secret="dev-dlr-secret",
        min_latency_ms=20,
        max_latency_ms=300,
        rate_limit_per_sec=50,
        p_temporary_failure=0.03,
        p_permanent_failure=0.01,
        p_timeout=0.01,
        timeout_seconds=5.0,
        dlr_min_delay_ms=500,
        dlr_max_delay_ms=10_000,
        p_delivrd=0.90,
        p_undeliv=0.07,
        p_expired=0.03,
        p_dlr_duplicate=0.10,
        p_dlr_early=0.05,
        idempotent_submit=False,
        random_seed=None,
    )


def test_every_variable_is_read_from_the_environment() -> None:
    config = CarrierConfig.from_env(
        {
            "GATEWAY_URL": "http://localhost:8000/",
            "DLR_SECRET": "s3cret",
            "MIN_LATENCY_MS": "1",
            "MAX_LATENCY_MS": "2",
            "RATE_LIMIT_PER_SEC": "7",
            "P_TEMPORARY_FAILURE": "0.2",
            "P_PERMANENT_FAILURE": "0.3",
            "P_TIMEOUT": "0.4",
            "TIMEOUT_SECONDS": "1.5",
            "DLR_MIN_DELAY_MS": "3",
            "DLR_MAX_DELAY_MS": "4",
            "P_DELIVRD": "0.5",
            "P_UNDELIV": "0.25",
            "P_EXPIRED": "0.25",
            "P_DLR_DUPLICATE": "0.6",
            "P_DLR_EARLY": "0.7",
            "IDEMPOTENT_SUBMIT": "true",
            "RANDOM_SEED": "42",
        }
    )

    assert config == CarrierConfig(
        gateway_url="http://localhost:8000",
        dlr_secret="s3cret",
        min_latency_ms=1,
        max_latency_ms=2,
        rate_limit_per_sec=7,
        p_temporary_failure=0.2,
        p_permanent_failure=0.3,
        p_timeout=0.4,
        timeout_seconds=1.5,
        dlr_min_delay_ms=3,
        dlr_max_delay_ms=4,
        p_delivrd=0.5,
        p_undeliv=0.25,
        p_expired=0.25,
        p_dlr_duplicate=0.6,
        p_dlr_early=0.7,
        idempotent_submit=True,
        random_seed=42,
    )


def test_blank_variable_falls_back_to_the_default() -> None:
    config = CarrierConfig.from_env({"RATE_LIMIT_PER_SEC": "", "RANDOM_SEED": "  "})

    assert config.rate_limit_per_sec == 50
    assert config.random_seed is None


@pytest.mark.parametrize(
    ("env", "variable"),
    [
        ({"RATE_LIMIT_PER_SEC": "fifty"}, "RATE_LIMIT_PER_SEC"),
        ({"RATE_LIMIT_PER_SEC": "0"}, "RATE_LIMIT_PER_SEC"),
        ({"P_TIMEOUT": "1.5"}, "P_TIMEOUT"),
        ({"P_DLR_EARLY": "-0.1"}, "P_DLR_EARLY"),
        ({"IDEMPOTENT_SUBMIT": "maybe"}, "IDEMPOTENT_SUBMIT"),
        ({"MIN_LATENCY_MS": "400"}, "MIN_LATENCY_MS"),
        ({"DLR_MIN_DELAY_MS": "20000"}, "DLR_MIN_DELAY_MS"),
        ({"TIMEOUT_SECONDS": "-1"}, "TIMEOUT_SECONDS"),
        ({"P_TEMPORARY_FAILURE": "0.6", "P_PERMANENT_FAILURE": "0.5"}, "P_TEMPORARY_FAILURE"),
        ({"P_DELIVRD": "0", "P_UNDELIV": "0", "P_EXPIRED": "0"}, "P_DELIVRD"),
    ],
)
def test_bad_value_is_rejected_and_names_the_variable(env: dict[str, str], variable: str) -> None:
    with pytest.raises(ValueError, match=variable):
        CarrierConfig.from_env(env)


def test_sink_variables_are_matched_to_tenant_slugs() -> None:
    config = SinkConfig.from_env(
        {
            "SINK_FAIL_ACME_BANK": "0.2",
            "SINK_DELAY_MS_ACME_BANK": "200-1500",
            "SINK_FAIL_SHOPFAST": "1",
            "UNRELATED": "x",
        }
    )

    assert config.behaviour_for("acme-bank") == SinkBehaviour(fail_share=0.2, delay_ms=(200, 1500))
    assert config.behaviour_for("shopfast") == SinkBehaviour(fail_share=1.0, delay_ms=(0, 0))
    assert config.behaviour_for("someone-else") == SinkBehaviour()


@pytest.mark.parametrize(
    "env",
    [
        {"SINK_FAIL_SHOPFAST": "2"},
        {"SINK_FAIL_SHOPFAST": "often"},
        {"SINK_DELAY_MS_SHOPFAST": "200"},
        {"SINK_DELAY_MS_SHOPFAST": "1500-200"},
        {"SINK_DELAY_MS_SHOPFAST": "fast-slow"},
    ],
)
def test_bad_sink_value_is_rejected_and_names_the_variable(env: dict[str, str]) -> None:
    with pytest.raises(ValueError, match=next(iter(env))):
        SinkConfig.from_env(env)
